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

    Profanity in legitimate complaints is MASKED, and does not cause automatic rejection.
    """
    reasons: List[str] = []
    is_spam = False
    is_gibberish = False
    is_duplicate_flood = False
    is_off_topic = False
    is_abusive = False

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

    # Check extreme abusive / safety threat
    for pattern in ABUSIVE_PATTERNS:
        if pattern.search(text):
            is_abusive = True
            reasons.append("Contains extreme harassment or threats")
            break

    # Overall flagged status (Only flagged if spam, gibberish, duplicate flood, off-topic, or extreme abusive)
    flagged = is_spam or is_gibberish or is_duplicate_flood or is_off_topic or is_abusive

    return ModerationFlags(
        flagged=flagged,
        reasons=reasons,
        is_spam=is_spam,
        is_gibberish=is_gibberish,
        is_duplicate_flood=is_duplicate_flood,
        is_off_topic=is_off_topic,
        is_abusive=is_abusive,
        masked_text=masked_text
    )
