import pytest
from app.services.fallback import analyze_fallback, map_text_to_category, determine_urgency

def test_map_text_to_category():
    assert map_text_to_category("Mess food is terrible") == "mess"
    assert map_text_to_category("Wi-Fi in hostel is dead") == "infrastructure"
    assert map_text_to_category("Library books are missing") == "library"
    assert map_text_to_category("Shuttle bus was late") == "transport"

def test_determine_urgency():
    assert determine_urgency("There is a fire hazard in lab", "negative", -0.8) == "critical"
    assert determine_urgency("Wi-Fi has been dead for 3 days", "negative", -0.6) == "high"
    assert determine_urgency("Food was ok", "positive", 0.4) == "normal"

def test_analyze_fallback_multi_aspect():
    input_text = "Mess food is good but Wi-Fi in Block 3 has been dead for 3 days."
    aspects = analyze_fallback(input_text)
    assert len(aspects) >= 2

    # First aspect (Food / Mess)
    food_aspect = next((a for a in aspects if a.category == "mess"), None)
    assert food_aspect is not None
    assert food_aspect.sentiment == "positive"

    # Second aspect (Wi-Fi / Infrastructure)
    wifi_aspect = next((a for a in aspects if a.category == "infrastructure"), None)
    assert wifi_aspect is not None
    assert wifi_aspect.sentiment == "negative"
    assert wifi_aspect.urgency in ["high", "critical"]
