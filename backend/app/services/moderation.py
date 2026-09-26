import re
from typing import List, Tuple
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

def check_gibberish(text: str) -> bool:
    """Checks if text is gibberish (e.g., 'asdfghjklqwerty' or 'zzzzzzzz')."""
    words = [w for w in re.findall(r'\b[a-zA-Z]+\b', text) if len(w) > 4]
    if not words and len(text.strip()) > 15:
        # Check if text is just repeated special chars
        return True

    for word in words:
        # Check for 4+ identical consecutive chars
        if re.search(r'(.)\1{3,}', word.lower()):
            return True
        # Check vowel ratio in words longer than 5 chars
        vowels = sum(1 for c in word.lower() if c in 'aeiouy')
        if len(word) >= 6 and (vowels / len(word) < 0.12):
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

    # Check extreme abusive / safety threat
    for pattern in ABUSIVE_PATTERNS:
        if pattern.search(text):
            is_abusive = True
            reasons.append("Contains extreme harassment or threats")
            break

    # Overall flagged status (Only flagged if spam, gibberish, duplicate flood, or extreme abusive)
    flagged = is_spam or is_gibberish or is_duplicate_flood or is_abusive

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
