import pytest
from app.services.redact import redact_pii

def test_redact_phone():
    text = "Call me at 9876543210 or +91 9876543210 for details."
    redacted = redact_pii(text)
    assert "9876543210" not in redacted
    assert "[PHONE]" in redacted

def test_redact_email():
    text = "Send reports to student@example.com immediately."
    redacted = redact_pii(text)
    assert "student@example.com" not in redacted
    assert "[EMAIL]" in redacted

def test_redact_reg_no():
    text = "My registration number is 2021BTECH1001 and roll is REG123456."
    redacted = redact_pii(text)
    assert "2021BTECH1001" not in redacted
    assert "REG123456" not in redacted
    assert "[REG_NO]" in redacted

def test_redact_combined():
    text = "Student 2021CS001 at test@univ.edu called from 9876543210."
    redacted = redact_pii(text)
    assert redacted == "Student [REG_NO] at [EMAIL] called from [PHONE]."
