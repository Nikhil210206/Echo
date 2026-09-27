import re

# Email regex
EMAIL_REGEX = re.compile(
    r'\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b',
    re.IGNORECASE
)

# Phone regexes (10-digit Indian numbers, 5-5 grouped numbers, landlines, and standard formatted phone numbers)
PHONE_REGEXES = [
    # E.g. +91 9876543210, +91-9876543210, 9876543210 (starts with 6-9)
    re.compile(r'(?:\+91[\s.-]?)?[6-9]\d{9}\b'),
    # E.g. 98765 43210, +91 98765 43210 (5-5 grouped mobile starting with 6-9)
    re.compile(r'(?:\+91[\s.-]?)?[6-9]\d{4}[\s.-]\d{5}\b'),
    # E.g. 022-12345678, 080-12345678 (Indian landline with std area code)
    re.compile(r'\b0\d{2,4}[-.\s]\d{6,8}\b'),
    # E.g. (987) 654-3210, 987-654-3210, 987.654.3210 (explicit formatted phone)
    re.compile(r'\(?\d{3}\)?[\s.-]\d{3}[\s.-]\d{4}\b'),
]

# University Registration / Roll Number regexes
REG_NO_REGEXES = [
    # E.g. RA2411003011575 (Exact team format: RA + 13 digits)
    re.compile(r'\bRA\d{13}\b', re.IGNORECASE),
    # E.g. 2021BTECH1001, 2022CS0145
    re.compile(r'\b20\d{2}[A-Za-z]{2,6}\d{3,6}\b'),
    # E.g. 21BCE0451, 19ECE102
    re.compile(r'\b\d{2}[A-Za-z]{3,5}\d{3,5}\b'),
    # E.g. REG123456, ROLL987654, USN123456
    re.compile(r'\b(?:REG|ROLL|USN)[-:]?\s*\d{5,12}\b', re.IGNORECASE),
    # E.g. Registration number 1234567890, Reg No. 123456
    re.compile(r'(\b(?:REG|REGISTRATION|ROLL|STUDENT|USN)[-:]?\s*(?:NO|NUMBER)?[:.]?\s*)\d{5,12}\b', re.IGNORECASE),
    # E.g. ID: 123456, ID 987654
    re.compile(r'\bID[-:]\s*\d{5,10}\b', re.IGNORECASE),
]

def redact_pii(text: str) -> str:
    """
    Redacts PII (Phone numbers, Email addresses, University Registration numbers) from text.
    Does NOT attempt to identify user identity beyond replacing PII patterns.
    """
    if not text:
        return text

    redacted = text

    # 1. Redact Emails
    redacted = EMAIL_REGEX.sub('[EMAIL]', redacted)

    # 2. Redact Registration Numbers
    for reg_regex in REG_NO_REGEXES:
        if r'\1[REG_NO]' in reg_regex.pattern:
            redacted = reg_regex.sub(r'\1[REG_NO]', redacted)
        else:
            redacted = reg_regex.sub('[REG_NO]', redacted)

    # 3. Redact Phone Numbers
    for phone_regex in PHONE_REGEXES:
        redacted = phone_regex.sub('[PHONE]', redacted)

    return redacted
