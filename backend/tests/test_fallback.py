import pytest
from app.services.fallback import analyze_fallback, map_text_to_category, determine_urgency

def test_map_text_to_category_boundary_cases():
    assert map_text_to_category("The teacher was excellent") == "academics"
    assert map_text_to_category("The classroom is dirty") == "academics"
    assert map_text_to_category("I am sick of the bus") == "transport"
    assert map_text_to_category("The AC is broken") == "infrastructure"
    assert map_text_to_category("The classroom AC is broken") == "infrastructure"
    assert map_text_to_category("The room is dirty") == "hostel"
    assert map_text_to_category("The bathroom is dirty") == "infrastructure"
    assert map_text_to_category("The teacher is sick") == "academics"
    assert map_text_to_category("The bus service is bad") == "transport"
    assert map_text_to_category("The hostel room is bad") == "hostel"

def test_map_text_to_category_legitimate():
    assert map_text_to_category("Mess food is terrible") == "mess"
    assert map_text_to_category("Wi-Fi in hostel is dead") == "infrastructure"
    assert map_text_to_category("Library books are missing") == "library"
    assert map_text_to_category("Shuttle bus was late") == "transport"

def test_determine_urgency_hierarchy():
    assert determine_urgency("The chairs are slightly uncomfortable.", "negative", -0.2) == "normal"
    assert determine_urgency("The classroom AC is a little weak.", "negative", -0.3) == "normal"
    assert determine_urgency("The food could be better.", "negative", -0.2) == "normal"
    assert determine_urgency("The projector is broken.", "negative", -0.4) == "normal"
    assert determine_urgency("There is no electricity in the building.", "negative", -0.5) == "high"
    assert determine_urgency("Wi-Fi has been dead for 3 days", "negative", -0.6) == "high"
    assert determine_urgency("There is a fire in the laboratory.", "negative", -0.8) == "critical"
    assert determine_urgency("Someone is in immediate danger.", "negative", -0.9) == "critical"

def test_analyze_fallback_multi_aspect():
    input_text = "Mess food is good but Wi-Fi in Block 3 has been dead for 3 days."
    aspects = analyze_fallback(input_text)
    assert len(aspects) >= 2

    food_aspect = next((a for a in aspects if a.category == "mess"), None)
    assert food_aspect is not None
    assert food_aspect.sentiment == "positive"

    wifi_aspect = next((a for a in aspects if a.category == "infrastructure"), None)
    assert wifi_aspect is not None
    assert wifi_aspect.sentiment == "negative"
    assert wifi_aspect.urgency in ["high", "critical"]

def test_junk_aspect_placeholder_filtering():
    from app.services.redact import redact_pii
    assert len(analyze_fallback(redact_pii("Call 9876543210"))) == 0
    assert len(analyze_fallback(redact_pii("My number is 9876543210"))) == 0
    assert len(analyze_fallback("[PHONE]")) == 0
    assert len(analyze_fallback("[REG_NO]")) == 0
    assert len(analyze_fallback("Call [PHONE].")) == 0


def test_mocking_praise_is_negative_not_positive():
    aspects = analyze_fallback("roti is good for donkey")
    assert aspects
    assert all(a.sentiment == "negative" and a.sarcastic for a in aspects)
    assert aspects[0].category == "mess"
