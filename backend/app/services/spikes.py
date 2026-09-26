from datetime import datetime, timezone, timedelta
from typing import List, Dict, Any, Union
from app.schemas import SpikeResult, CategoryTrendResult

def compute_spike_alert(
    aspect_records: List[Dict[str, Any]],
    category: str,
    location_name: str,
    reference_time: Union[datetime, None] = None
) -> SpikeResult:
    """
    Computes deterministic spike statistic for a category and location pair:
    spike_ratio = C72h / max(B, 1)

    Where:
    - C72h = negative aspects in last 72 hours
    - B = average negative aspects per 72-hour window during previous 28 days

    Alert fires when spike_ratio >= 2.0 AND C72h >= 5.
    """
    if not reference_time:
        reference_time = datetime.now(timezone.utc)

    now = reference_time
    h72_ago = now - timedelta(hours=72)
    d31_ago = now - timedelta(days=31)

    c72h = 0
    prev_28d_count = 0

    for item in aspect_records:
        sentiment = str(item.get("sentiment", "")).lower()
        if sentiment != "negative":
            continue

        item_cat = str(item.get("category", "")).lower()
        if item_cat != category.lower():
            continue

        item_loc = str(item.get("location_name", item.get("location", ""))).lower()
        if location_name and item_loc and location_name.lower() not in item_loc and item_loc not in location_name.lower():
            continue

        created_at = item.get("created_at")
        if isinstance(created_at, str):
            try:
                created_at = datetime.fromisoformat(created_at.replace("Z", "+00:00"))
            except ValueError:
                continue

        if created_at and created_at.tzinfo is None:
            created_at = created_at.replace(tzinfo=timezone.utc)

        if not created_at:
            continue

        if created_at >= h72_ago:
            c72h += 1
        elif d31_ago <= created_at < h72_ago:
            prev_28d_count += 1

    # B = average per 72h window in the 28-day baseline period (28 / 3 = 9.333 windows)
    num_windows = 28.0 / 3.0
    baseline_b = prev_28d_count / num_windows

    denom = max(baseline_b, 1.0)
    spike_ratio = c72h / denom

    is_spike = (spike_ratio >= 2.0) and (c72h >= 5)

    display_text = (
    f"{category.title()} · {location_name}: {c72h} reports in 3 days "
    f"vs a usual {round(baseline_b, 1)} → {round(spike_ratio, 1)}×"
)

    return SpikeResult(
        category=category,
        location=location_name,
        c72h=c72h,
        baseline_b=round(baseline_b, 2),
        spike_ratio=round(spike_ratio, 2),
        is_spike=is_spike,
        display_text=display_text
    )

def compute_week_over_week_trend(
    aspect_records: List[Dict[str, Any]],
    category: str,
    reference_time: Union[datetime, None] = None
) -> CategoryTrendResult:
    """
    Computes week-over-week percentage change for negative aspects in a category.
    """
    if not reference_time:
        reference_time = datetime.now(timezone.utc)

    now = reference_time
    d7_ago = now - timedelta(days=7)
    d14_ago = now - timedelta(days=14)

    current_week = 0
    prev_week = 0

    for item in aspect_records:
        if str(item.get("sentiment", "")).lower() != "negative":
            continue
        if str(item.get("category", "")).lower() != category.lower():
            continue

        created_at = item.get("created_at")
        if isinstance(created_at, str):
            try:
                created_at = datetime.fromisoformat(created_at.replace("Z", "+00:00"))
            except ValueError:
                continue

        if created_at and created_at.tzinfo is None:
            created_at = created_at.replace(tzinfo=timezone.utc)

        if not created_at:
            continue

        if created_at >= d7_ago:
            current_week += 1
        elif d14_ago <= created_at < d7_ago:
            prev_week += 1

    if prev_week == 0:
        pct_change = 100.0 if current_week > 0 else 0.0
    else:
        pct_change = ((current_week - prev_week) / prev_week) * 100.0

    arrow = "↑" if pct_change >= 0 else "↓"
    display_text = f"{category.title()} complaints {arrow} {abs(round(pct_change))}% this week"

    return CategoryTrendResult(
        category=category,
        current_week_count=current_week,
        previous_week_count=prev_week,
        percentage_change=round(pct_change, 1),
        display_text=display_text
    )
