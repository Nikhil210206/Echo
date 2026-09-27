import pytest
from app.services.redact import redact_pii

def test_redact_false_positives():
    assert "[REG_NO]" not in redact_pii("Student complaints are ignored")
    assert "[REG_NO]" not in redact_pii("The radiator in my room is broken")
    assert "[REG_NO]" not in redact_pii("Two identical complaints")
    assert "[REG_NO]" not in redact_pii("Ravindra sir was absent")
    assert "[REG_NO]" not in redact_pii("RA committee meeting")
    assert "[REG_NO]" not in redact_pii("RA")
    assert "[REG_NO]" not in redact_pii("Ravi")
    assert redact_pii("Hall 1204 5678") == "Hall 1204 5678"
    assert redact_pii("Room 1204") == "Room 1204"
    assert redact_pii("Block 1204") == "Block 1204"
    assert redact_pii("The code is 1204 5678") == "The code is 1204 5678"

def test_redact_ra_format_true_positives():
    assert redact_pii("Student RA2411003011575 has a complaint") == "Student [REG_NO] has a complaint"
    assert redact_pii("My registration number is RA2411003011575") == "My registration number is [REG_NO]"
    assert redact_pii("RA2411003011575") == "[REG_NO]"

def test_redact_phone_true_positives():
    assert redact_pii("9876543210") == "[PHONE]"
    assert redact_pii("+91 9876543210") == "[PHONE]"
    assert redact_pii("98765 43210") == "[PHONE]"
    assert redact_pii("+91 98765 43210") == "[PHONE]"
    assert redact_pii("022-12345678") == "[PHONE]"
    text = "Call me at 98765 43210 or 022-12345678 for details."
    redacted = redact_pii(text)
    assert "98765 43210" not in redacted
    assert "022-12345678" not in redacted
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
