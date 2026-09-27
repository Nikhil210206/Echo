import pytest
from app.services.moderation import moderate_text, check_gibberish

def test_gibberish_false_positives_pass():
    assert check_gibberish("wifi is not on in my room at all") is False
    assert check_gibberish("The food is soooo bad today honestly") is False
    assert check_gibberish("Our strengths are not being used in labs") is False
    assert check_gibberish("मेस का खाना बहुत खराब है") is False

def test_gibberish_true_positives_fail():
    assert check_gibberish("asdfghjklqwerty") is True
    assert check_gibberish("zzzzzzzzzzzz") is True

def test_spam_detection():
    mod = moderate_text("Click here to earn free money at http://spam.example.com")
    assert mod.flagged is True
    assert mod.is_spam is True

def test_off_topic_detection():
    mod = moderate_text("The latest movie starring Brad Pitt was an amazing cinematic experience with great visual effects")
    assert mod.flagged is True
    assert mod.is_off_topic is True

def test_duplicate_flood_detection():
    mod = moderate_text("bad food bad food bad food bad food bad food bad food bad food bad food bad food bad food")
    assert mod.flagged is True
    assert mod.is_duplicate_flood is True

def test_legitimate_complaint_with_profanity():
    text = "The mess food is fucking terrible and made me sick."
    mod = moderate_text(text)
    assert mod.flagged is False
    assert "f***" in mod.masked_text or "f******" in mod.masked_text
    assert "terrible" in mod.masked_text
