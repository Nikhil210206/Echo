import re
from typing import List
from app.schemas import ModerationFlags

# Common profanity words list for masking (preserving valid complaints)
PROFANITY_WORDS = [
    "fuck", "fucking", "fucked", "fucker",
    "shit", "shitty", "shitting",
    "bitch", "bitches",
    "asshole", "bastard", "dick", "pussy",
    "crap", "damn"
]

# Patterns for profanity masking
PROFANITY_PATTERNS = [
    (re.compile(r'\b' + re.escape(w) + r'\b', re.IGNORECASE), w[0] + '*' * (len(w) - 1))
    for w in PROFANITY_WORDS
]

# Severe abusive/hate speech patterns that make feedback abusive
ABUSIVE_PATTERNS = [
    re.compile(r'\b(kill yourself|go die|i will kill|threat|terrorist|hate group)\b', re.IGNORECASE)
]

# Mockery: praise that is really an insult ("roti is good for donkeys", "not even dogs would eat this").
# It reads as positive to a sentiment lexicon, so it is flagged for review and treated as negative.
ANIMAL = r'(?:(?:street\s+)?dogs?|donkeys?|pigs?|cows?|cattle|goats?|buffalo(?:e?s)?|animals?|horses?|monkeys?|rats?|cats?|strays?)'
SARCASM_PATTERNS = [
    re.compile(r'\b(?:good|fit|fine|great|perfect|suitable|only|made|meant|best)\s+(?:only\s+)?for\s+(?:the\s+)?' + ANIMAL + r'\b', re.IGNORECASE),
    re.compile(r'\b(?:not\s+even|even)\s+(?:the\s+|a\s+)?' + ANIMAL + r'\s+(?:would|will|wont|won\'t|can|could|cannot|can\'t|don\'t|dont|didn\'t)\b', re.IGNORECASE),
    re.compile(r'\b(?:feed|give)\s+(?:it|this|them)\s+to\s+(?:the\s+)?' + ANIMAL + r'\b', re.IGNORECASE),
]

def check_sarcasm(text: str) -> bool:
    """Flags mocking praise such as 'roti is good for donkeys'."""
    return bool(text) and any(p.search(text) for p in SARCASM_PATTERNS)

# Jokes and personal mishaps that mention a campus word but say nothing about how the place is run
# ("dog ate my food", "my cat stole my lunch"). Held for review rather than opening an issue.
JOKE_PATTERNS = [
    re.compile(r'\b(?:my\s+|the\s+|a\s+)?' + ANIMAL + r'\s+(?:ate|eaten|stole|took|licked|drank)\s+(?:my|our)\b', re.IGNORECASE),
]

def check_joke(text: str) -> bool:
    """Flags jokes and personal mishaps such as 'dog ate my food'."""
    return bool(text) and any(p.search(text) for p in JOKE_PATTERNS)

# Spam patterns
SPAM_PATTERNS = [
    re.compile(r'https?://\S+|www\.\S+', re.IGNORECASE),
    re.compile(r'\b(buy now|click here|crypto|bitcoin|casino|free money|earn \$\d+)\b', re.IGNORECASE)
]

def mask_profanity(text: str) -> str:
    """Masks profanity words while preserving sentence structure."""
    if not text:
        return text
    masked = text
    for pattern, replacement in PROFANITY_PATTERNS:
        masked = pattern.sub(replacement, masked)
    return masked

COMMON_VOWELS = set('aeiouyAEIOUY')

CAMPUS_KEYWORDS = {
    'mess', 'food', 'canteen', 'dinner', 'lunch', 'breakfast', 'meal', 'curry', 'roti',
    'hostel', 'room', 'bed', 'warden', 'block', 'roommate', 'doorknob', 'window',
    'wifi', 'internet', 'network', 'ac', 'lift', 'water', 'electricity', 'power', 'fan', 'washroom', 'toilet',
    'bus', 'shuttle', 'transport', 'cab', 'parking', 'driver',
    'library', 'books', 'study', 'journals', 'lab', 'equipment',
    'exam', 'faculty', 'professor', 'teacher', 'classroom', 'lecture', 'assignment', 'timetable',
    'campus', 'college', 'university', 'sir', 'mam', 'student', 'facility', 'complaint', 'service', 'strength', 'strengths'
}

def check_gibberish(text: str) -> bool:
    """
    Conservatively checks if text is genuinely random nonsensical gibberish (e.g. 'asdfghjklqwerty' or 'zzzzzzzz').
    Does NOT flag normal English sentences, short words, vowel repetitions ('soooo'), or multilingual Unicode text.
    """
    if not text or not text.strip():
        return False

    clean_text = text.strip()

    # 1. Check for 5+ identical consecutive character repetitions (e.g. zzzzzzzzzzzz)
    if re.search(r'(.)\1{4,}', clean_text.lower()):
        return True

    # 2. Check for obvious keyboard sweep patterns (e.g. asdfghjklqwerty)
    if re.search(r'(asdfgh|qwerty|zxcvbn|dfghjk)', clean_text.lower()):
        return True

    # 3. Check long English words (8+ chars) with strictly zero vowels (e.g. 'qwrtypsdfghjkl')
    words = re.findall(r'\b[a-zA-Z]+\b', clean_text)
    for word in words:
        w_lower = word.lower()
        if len(w_lower) >= 8 and not any(c in COMMON_VOWELS for c in w_lower):
            return True

    return False

def check_off_topic(text: str) -> bool:
    """
    Conservatively flags text as off-topic if it is a longer submission (>8 words)
    that lacks campus/facility keywords or feedback context.
    """
    if not text or len(text.strip().split()) < 8:
        return False

    words = set(re.findall(r'\b[a-zA-Z]+\b', text.lower()))
    if not words:
        return False

    if words.intersection(CAMPUS_KEYWORDS):
        return False

    # Check for promotional or unrelated media terms
    if any(k in text.lower() for k in ['movie', 'starring', 'crypto', 'bitcoin', 'investment', 'casino']):
        return True

    return False

def check_duplicate_flood(text: str) -> bool:
    """Checks if text consists of repeated phrase loops."""
    words = text.split()
    if len(words) >= 10:
        unique_ratio = len(set(words)) / len(words)
        if unique_ratio < 0.25:
            return True
    return False

def moderate_text(text: str) -> ModerationFlags:
    """
    Evaluates text for moderation flags:
    - spam
    - gibberish
    - duplicate flood
    - off-topic
    - abusive
    - sarcasm (mocking praise, reviewed before it counts)

    Profanity in legitimate complaints is MASKED, and does not cause automatic rejection.
    """
    reasons: List[str] = []
    is_spam = False
    is_gibberish = False
    is_duplicate_flood = False
    is_off_topic = False
    is_abusive = False
    is_sarcastic = False

    # Mask profanity
    masked_text = mask_profanity(text)

    # Check spam
    for pattern in SPAM_PATTERNS:
        if pattern.search(text):
            is_spam = True
            reasons.append("Contains promotional links or spam keywords")
            break

    # Check gibberish
    if check_gibberish(text):
        is_gibberish = True
        reasons.append("Text appears to be gibberish or random characters")

    # Check duplicate flood
    if check_duplicate_flood(text):
        is_duplicate_flood = True
        reasons.append("Text contains duplicate flood repetitive patterns")

    # Check off-topic
    if check_off_topic(text):
        is_off_topic = True
        reasons.append("Feedback appears off-topic or unrelated to campus facilities")
    elif check_joke(text):
        is_off_topic = True
        reasons.append("Reads like a joke or personal mishap, not feedback about this place")

    # Check extreme abusive / safety threat
    for pattern in ABUSIVE_PATTERNS:
        if pattern.search(text):
            is_abusive = True
            reasons.append("Contains extreme harassment or threats")
            break

    # Mocking praise: not a real compliment, and not a clear complaint either
    if check_sarcasm(text):
        is_sarcastic = True
        reasons.append("Sarcastic or mocking, not a genuine compliment")

    # Overall flagged status (Only flagged if spam, gibberish, duplicate flood, off-topic, extreme abusive or sarcastic)
    flagged = is_spam or is_gibberish or is_duplicate_flood or is_off_topic or is_abusive or is_sarcastic

    return ModerationFlags(
        flagged=flagged,
        reasons=reasons,
        is_spam=is_spam,
        is_gibberish=is_gibberish,
        is_duplicate_flood=is_duplicate_flood,
        is_off_topic=is_off_topic,
        is_abusive=is_abusive,
        is_sarcastic=is_sarcastic,
        masked_text=masked_text
    )
