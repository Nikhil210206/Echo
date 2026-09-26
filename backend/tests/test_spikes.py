import pytest
from datetime import datetime, timezone, timedelta
from app.services.spikes import compute_spike_alert, compute_week_over_week_trend

def test_spike_alert_triggered():
    now = datetime.now(timezone.utc)
    aspect_records = []

    # 17 negative reports in the last 72 hours
    for _ in range(17):
        aspect_records.append({
            "category": "infrastructure",
            "location_name": "Hostel Block 3",
            "sentiment": "negative",
            "created_at": (now - timedelta(hours=24)).isoformat()
        })

    # Baseline: 37 negative reports in previous 28 days -> average ~ 37 / (28/3) = 39.6 / 9.333 = 4.0
    for _ in range(37):
        aspect_records.append({
            "category": "infrastructure",
            "location_name": "Hostel Block 3",
            "sentiment": "negative",
            "created_at": (now - timedelta(days=15)).isoformat()
        })

    spike = compute_spike_alert(aspect_records, "infrastructure", "Hostel Block 3", reference_time=now)
    assert spike.c72h == 17
    assert spike.baseline_b == 3.96
    assert spike.spike_ratio >= 4.0
    assert spike.is_spike is True
    assert "Hostel Block 3" in spike.display_text
    assert "reports in 3 days vs a usual" in spike.display_text

def test_week_over_week_trend():
    now = datetime.now(timezone.utc)
    records = []
    # 10 negative mess reports this week
    for _ in range(10):
        records.append({
            "category": "mess",
            "sentiment": "negative",
            "created_at": (now - timedelta(days=3)).isoformat()
        })
    # 5 negative mess reports previous week
    for _ in range(5):
        records.append({
            "category": "mess",
            "sentiment": "negative",
            "created_at": (now - timedelta(days=10)).isoformat()
        })

    trend = compute_week_over_week_trend(records, "mess", reference_time=now)
    assert trend.current_week_count == 10
    assert trend.previous_week_count == 5
    assert trend.percentage_change == 100.0
    assert "Mess complaints ↑ 100% this week" in trend.display_text
