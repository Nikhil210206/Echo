import pytest
from datetime import datetime, timezone, timedelta
from app.services.priority import calculate_priority_score

def test_priority_score_calculation():
    now = datetime.now(timezone.utc)
    reports = [
        {"sentiment": "negative", "created_at": (now - timedelta(days=2)).isoformat()},
        {"sentiment": "negative", "created_at": (now - timedelta(days=5)).isoformat()},
        {"sentiment": "negative", "created_at": (now - timedelta(days=10)).isoformat()}, # older -> 0.5
    ]

    # Rw = 1.0 + 1.0 + 0.5 = 2.5
    # N = 3 / 3 = 1.0
    # U = high = 2.0
    # expected priority = 2.5 * 1.0 * 2.0 = 5.0
    res = calculate_priority_score(reports, highest_urgency="high", reference_time=now)
    assert res.priority_score == 5.0
    assert res.breakdown.recency_weighted_reports == 2.5
    assert res.breakdown.negative_share == 1.0
    assert res.breakdown.urgency_multiplier == 2.0
    assert res.breakdown.formula == "Rw × N × U"
