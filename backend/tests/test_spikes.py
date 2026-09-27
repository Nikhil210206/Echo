import pytest
from datetime import datetime, timezone, timedelta
from app.services.spikes import compute_spike_alert, compute_week_over_week_trend

def test_spike_location_matching():
    now = datetime.now(timezone.utc)
    aspect_records = [
        {"category": "infrastructure", "location_name": "Hostel Block 12", "sentiment": "negative", "created_at": (now - timedelta(hours=10)).isoformat()},
        {"category": "infrastructure", "location_name": "", "sentiment": "negative", "created_at": (now - timedelta(hours=10)).isoformat()},
        {"category": "infrastructure", "location_name": None, "sentiment": "negative", "created_at": (now - timedelta(hours=10)).isoformat()},
    ]

    # Query for Hostel Block 1 should ignore Hostel Block 12 and empty locations
    res_block1 = compute_spike_alert(aspect_records, "infrastructure", "Hostel Block 1", reference_time=now)
    assert res_block1.c72h == 0
    assert res_block1.is_spike is False

    # Exact location match for Hostel Block 12
    res_block12 = compute_spike_alert(aspect_records, "infrastructure", "Hostel Block 12", reference_time=now)
    assert res_block12.c72h == 1

def test_spike_alert_triggered():
    now = datetime.now(timezone.utc)
    aspect_records = []

    for _ in range(17):
        aspect_records.append({
            "category": "infrastructure",
            "location_name": "Hostel Block 3",
            "sentiment": "negative",
            "created_at": (now - timedelta(hours=24)).isoformat()
        })

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

def test_week_over_week_trend():
    now = datetime.now(timezone.utc)
    records = []
    for _ in range(10):
        records.append({
            "category": "mess",
            "sentiment": "negative",
            "created_at": (now - timedelta(days=3)).isoformat()
        })
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
