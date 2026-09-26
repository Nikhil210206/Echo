import re

# Email regex
EMAIL_REGEX = re.compile(
    r'\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b',
    re.IGNORECASE
)

# Phone regex (Indian/international 10-12 digit patterns with optional separators/country codes)
PHONE_REGEX = re.compile(
    r'(?:\+?\d{1,3}[\s.-]?)?(?:\(?\d{3,5}\)?[\s.-]?)?\d{3,4}[\s.-]?\d{4}\b'
)

# Alternative simple 10-digit phone regex for standalone numbers
TEN_DIGIT_PHONE_REGEX = re.compile(r'\b[6-9]\d{9}\b')

# University Registration / Roll Number regexes
REG_NO_REGEXES = [
    # E.g. 2021BTECH1001, 2022CS0145
    re.compile(r'\b20\d{2}[A-Z]{2,6}\d{3,6}\b', re.IGNORECASE),
    # E.g. REG123456, ROLL987654
    re.compile(r'\b(?:REG|ROLL|STUDENT|ID|RA|USN)[-:]?\s*[A-Z0-9]{6,12}\b', re.IGNORECASE),
    # E.g. 21BCE0451, 19ECE102
    re.compile(r'\b\d{2}[A-Z]{3,5}\d{3,5}\b', re.IGNORECASE),
]

def redact_pii(text: str) -> str:
    """
    Redacts PII (Phone numbers, Email addresses, University Registration numbers) from text.
    Does NOT attempt to identify user identity beyond replacing PII patterns.
    """
    if not text:
        return text

    redacted = text

    # Redact Emails
    redacted = EMAIL_REGEX.sub('[EMAIL]', redacted)

    # Redact Registration Numbers
    for reg_regex in REG_NO_REGEXES:
        redacted = reg_regex.sub('[REG_NO]', redacted)

    # Redact explicit 10-digit Indian phone numbers
    redacted = TEN_DIGIT_PHONE_REGEX.sub('[PHONE]', redacted)

    # Redact formatted phone numbers
    def replace_phone(match):
        val = match.group(0).strip()
        # Ensure it contains at least 7 digits to avoid matching short dates or numbers
        digits = re.sub(r'\D', '', val)
        if 7 <= len(digits) <= 13:
            return '[PHONE]'
        return val

    redacted = PHONE_REGEX.sub(replace_phone, redacted)

    return redacted
