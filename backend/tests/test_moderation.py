import pytest
from app.services.moderation import moderate_text

def test_spam_detection():
    mod = moderate_text("Click here to earn free money at http://spam.example.com")
    assert mod.flagged is True
    assert mod.is_spam is True

def test_gibberish_detection():
    mod = moderate_text("asdfghjklqwerty zzzzzzzzzz xcvbnm")
    assert mod.flagged is True
    assert mod.is_gibberish is True

def test_duplicate_flood_detection():
    mod = moderate_text("bad food bad food bad food bad food bad food bad food bad food bad food bad food bad food")
    assert mod.flagged is True
    assert mod.is_duplicate_flood is True

def test_legitimate_complaint_with_profanity():
    text = "The mess food is fucking terrible and made me sick."
    mod = moderate_text(text)
    # Legitimate complaint with profanity should NOT be flagged as abusive block
    assert mod.flagged is False
    assert "f***" in mod.masked_text or "f******" in mod.masked_text
    assert "terrible" in mod.masked_text
