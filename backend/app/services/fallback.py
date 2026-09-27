import re
from typing import List
from vaderSentiment.vaderSentiment import SentimentIntensityAnalyzer
from app.schemas import AspectResult

analyzer = SentimentIntensityAnalyzer()

# Word-boundary category keyword matching patterns
CATEGORY_KEYWORD_PATTERNS = {
    "mess": [
        re.compile(r'\b(?:mess|food|canteen|dinner|lunch|breakfast|meal|roti|curry|water cooler in mess|food poisoning|vomit)\b', re.IGNORECASE),
        re.compile(r'\b(?:sick|poison)(?:\s+\w+){0,3}\s+(?:food|mess|curry|meal)\b', re.IGNORECASE),
        re.compile(r'\b(?:food|mess|curry|meal)(?:\s+\w+){0,3}\s+(?:sick|poison)\b', re.IGNORECASE)
    ],
    "infrastructure": [
        re.compile(r'\b(?:wifi|wi-fi|internet|network|ac|air conditioner|lift|elevator|water|electricity|power|fan|light|washroom|toilet|bathroom|plumbing)\b', re.IGNORECASE)
    ],
    "hostel": [
        re.compile(r'\b(?:hostel|room|bed|warden|block|roommate|doorknob|window)\b', re.IGNORECASE)
    ],
    "transport": [
        re.compile(r'\b(?:bus|shuttle|transport|cab|parking|driver)\b', re.IGNORECASE)
    ],
    "library": [
        re.compile(r'\b(?:library|books|study room|librarian|journals)\b', re.IGNORECASE)
    ],
    "academics": [
        re.compile(r'\b(?:exam|faculty|professor|teacher|classroom|lecture|assignment|lab|lab equipment|timetable)\b', re.IGNORECASE)
    ]
}

# Urgency Keywords
CRITICAL_KEYWORDS = [
    "danger", "emergency", "hazard", "fire", "electrical shock", "injury", "poison", "gas leak"
]

HIGH_URGENCY_KEYWORDS = [
    "dead", "overflowing", "3 days", "4 days", "5 days", "a week", "stopped working", "no water", "no electricity", "power outage", "no power"
]

# Prompt injection meta phrases
PROMPT_INJECTION_META_PATTERNS = [
    re.compile(r'\bignore (?:all )?(?:previous )?instructions?\b', re.IGNORECASE),
    re.compile(r'\bmark (?:this|as) (?:positive|good|neutral)\b', re.IGNORECASE),
    re.compile(r'\bsystem prompt\b', re.IGNORECASE),
    re.compile(r'\byou are an? ai\b', re.IGNORECASE)
]

# Placeholder-only patterns to filter junk aspects
PLACEHOLDER_ONLY_PATTERN = re.compile(
    r'^(?:my|the|this)?\s*(?:call|email|reach|contact|send|id|reg|roll|number|phone)?\s*(?:is|me|us|at|to|on)?\s*'
    r'(?:\[PHONE\]|\[EMAIL\]|\[REG_NO\]|\.|\s)*$',
    re.IGNORECASE
)

FILLER_WORDS = {'my', 'the', 'this', 'call', 'email', 'reach', 'contact', 'send', 'id', 'reg', 'roll', 'me', 'us', 'at', 'to', 'on', 'is', 'number', 'phone', 'please', 'thanks'}

def is_prompt_injection_meta(clause: str) -> bool:
    for pattern in PROMPT_INJECTION_META_PATTERNS:
        if pattern.search(clause):
            return True
    return False

def is_meaningless_placeholder_aspect(text: str) -> bool:
    cleaned = text.strip()
    if not cleaned:
        return True
    if PLACEHOLDER_ONLY_PATTERN.match(cleaned):
        return True

    without_placeholders = re.sub(r'\[(PHONE|EMAIL|REG_NO)\]', '', cleaned, flags=re.IGNORECASE).strip(' .,!?:;')
    words = [w.lower() for w in re.findall(r'\b[a-zA-Z]+\b', without_placeholders)]
    non_filler_words = [w for w in words if w not in FILLER_WORDS]
    if not non_filler_words:
        return True
    return False

def map_text_to_category(text: str) -> str:
    text_lower = text.lower()
    for cat, patterns in CATEGORY_KEYWORD_PATTERNS.items():
        for pat in patterns:
            if pat.search(text_lower):
                return cat
    return "general"

def extract_aspect_noun(text: str) -> str:
    text_lower = text.lower()
    for cat, patterns in CATEGORY_KEYWORD_PATTERNS.items():
        for pat in patterns:
            match = pat.search(text_lower)
            if match:
                return match.group(0).title()
    return "Facility"

def determine_urgency(text: str, sentiment: str, compound_score: float) -> str:
    text_lower = text.lower()
    if any(k in text_lower for k in CRITICAL_KEYWORDS):
        return "critical"
    if sentiment == "negative":
        if any(k in text_lower for k in HIGH_URGENCY_KEYWORDS) or compound_score <= -0.65:
            return "high"
    return "normal"

def analyze_fallback(text: str) -> List[AspectResult]:
    """
    Deterministic fallback analysis when LLM is unavailable.
    Splits text by conjunctions ('but', 'however', 'and also', ',', '.', ';') into clauses,
    filters meta prompt injection phrases and placeholder junk, evaluates sentiment with VADER,
    and extracts aspect & category.
    """
    if not text:
        return []

    # Split text into clauses/sentences (including commas separating distinct clauses)
    clauses = re.split(r'\b(?:but|however|although|and also|whereas)\b|[,.;!]', text, flags=re.IGNORECASE)
    cleaned_clauses = [c.strip() for c in clauses if c and len(c.strip()) > 3]

    if not cleaned_clauses:
        cleaned_clauses = [text.strip()]

    aspects: List[AspectResult] = []

    for clause in cleaned_clauses:
        # Ignore meta injection commands in aspect breakdown
        if is_prompt_injection_meta(clause):
            continue

        # Filter out redacted placeholder junk (e.g. "Call [PHONE].")
        if is_meaningless_placeholder_aspect(clause):
            continue

        vs = analyzer.polarity_scores(clause)
        compound = vs['compound']

        # Sickness/illness from food is inherently negative
        if any(k in clause.lower() for k in ["sick from food", "food poisoning", "food made me sick", "vomit"]):
            sentiment = "negative"
            compound = min(compound, -0.65)
        elif compound >= 0.05:
            sentiment = "positive"
        elif compound <= -0.05:
            sentiment = "negative"
        else:
            sentiment = "neutral"

        cat = map_text_to_category(clause)
        aspect_name = extract_aspect_noun(clause)
        urgency = determine_urgency(clause, sentiment, compound)

        aspects.append(
            AspectResult(
                aspect=aspect_name,
                category=cat,
                sentiment=sentiment,
                urgency=urgency,
                evidence_span=clause
            )
        )

    return aspects
