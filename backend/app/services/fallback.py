import re
from typing import List
from vaderSentiment.vaderSentiment import SentimentIntensityAnalyzer
from app.schemas import AspectResult

analyzer = SentimentIntensityAnalyzer()

# Keyword to category mapping rules
CATEGORY_KEYWORDS = {
    "mess": ["mess", "food", "canteen", "dinner", "lunch", "breakfast", "meal", "roti", "curry", "water cooler in mess", "sick", "poison"],
    "infrastructure": ["wifi", "wi-fi", "internet", "network", "ac", "air conditioner", "lift", "elevator", "water", "electricity", "power", "fan", "light", "washroom", "toilet", "plumbing"],
    "hostel": ["hostel", "room", "bed", "warden", "block", "cleaning", "roommate", "doorknob", "window"],
    "transport": ["bus", "shuttle", "transport", "cab", "parking", "driver"],
    "library": ["library", "books", "study room", "librarian", "journals"],
    "academics": ["exam", "faculty", "professor", "lecture", "assignment", "lab", "lab equipment", "timetable"]
}

URGENT_KEYWORDS = [
    "dead", "broken", "danger", "emergency", "hazard", "overflowing", "sick", "poison",
    "3 days", "4 days", "5 days", "week", "days", "immediately", "worst",
    "severe", "stopped working", "no water", "fire", "electrical shock"
]

CRITICAL_KEYWORDS = [
    "danger", "emergency", "hazard", "fire", "electrical shock", "injury", "poison"
]

# Phrases common in prompt injection attempts that shouldn't form legitimate feedback aspects
PROMPT_INJECTION_META_PATTERNS = [
    re.compile(r'\bignore (?:all )?(?:previous )?instructions?\b', re.IGNORECASE),
    re.compile(r'\bmark (?:this|as) (?:positive|good|neutral)\b', re.IGNORECASE),
    re.compile(r'\bsystem prompt\b', re.IGNORECASE),
    re.compile(r'\byou are an? ai\b', re.IGNORECASE)
]

def is_prompt_injection_meta(clause: str) -> bool:
    for pattern in PROMPT_INJECTION_META_PATTERNS:
        if pattern.search(clause):
            return True
    return False

def map_text_to_category(text: str) -> str:
    text_lower = text.lower()
    for cat, keywords in CATEGORY_KEYWORDS.items():
        for kw in keywords:
            if kw in text_lower:
                return cat
    return "general"

def extract_aspect_noun(text: str) -> str:
    text_lower = text.lower()
    for cat, keywords in CATEGORY_KEYWORDS.items():
        for kw in keywords:
            if kw in text_lower:
                return kw.title()
    return "Facility"

def determine_urgency(text: str, sentiment: str, compound_score: float) -> str:
    text_lower = text.lower()
    if any(k in text_lower for k in CRITICAL_KEYWORDS):
        return "critical"
    if sentiment == "negative" and (any(k in text_lower for k in URGENT_KEYWORDS) or compound_score <= -0.4):
        return "high"
    if sentiment == "negative" and compound_score < -0.1:
        return "high"
    return "normal"

def analyze_fallback(text: str) -> List[AspectResult]:
    """
    Deterministic fallback analysis when LLM is unavailable.
    Splits text by conjunctions ('but', 'however', 'and also', '.', ';') into clauses,
    filters meta prompt injection phrases, evaluates sentiment with VADER, and extracts aspect & category.
    """
    if not text:
        return []

    # Split text into clauses/sentences
    clauses = re.split(r'\b(?:but|however|although|and also|whereas)\b|[.;!]', text, flags=re.IGNORECASE)
    cleaned_clauses = [c.strip() for c in clauses if c and len(c.strip()) > 3]

    if not cleaned_clauses:
        cleaned_clauses = [text.strip()]

    aspects: List[AspectResult] = []

    for clause in cleaned_clauses:
        # Ignore meta injection commands in aspect breakdown
        if is_prompt_injection_meta(clause):
            continue

        vs = analyzer.polarity_scores(clause)
        compound = vs['compound']

        # Sickness/illness from food is inherently negative regardless of VADER raw score
        if any(k in clause.lower() for k in ["sick", "poison", "food poisoning", "vomit"]):
            sentiment = "negative"
            compound = min(compound, -0.6)
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

    if not aspects:
        # If all clauses were prompt injection, default to a negative security aspect
        aspects.append(
            AspectResult(
                aspect="Feedback",
                category="general",
                sentiment="negative",
                urgency="high",
                evidence_span=text
            )
        )

    return aspects
