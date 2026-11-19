from datetime import datetime, timezone, timedelta
from typing import List, Dict, Any, Union
from app.schemas import PriorityResult, PriorityBreakdown

URGENCY_MAP = {
    "critical": 3.0,
    "high": 2.0,
    "normal": 1.0
}

def calculate_priority_score(
    reports: List[Dict[str, Any]],
    highest_urgency: str = "normal",
    reference_time: Union[datetime, None] = None
) -> PriorityResult:
    """
    Calculates issue priority score using the formula:
    priority = Rw * N * U

    Where:
    - Rw = recency-weighted report count (last 7 days = 1.0, older = 0.5)
    - N = share of negative reports (negative_reports / total_reports)
    - U = urgency multiplier (critical = 3, high = 2, normal = 1)
    """
    if not reference_time:
        reference_time = datetime.now(timezone.utc)

    if not reports:
        # Default for single submission or empty list
        u_mult = URGENCY_MAP.get(highest_urgency.lower(), 1.0)
        return PriorityResult(
            priority_score=round(1.0 * 1.0 * u_mult, 2),
            breakdown=PriorityBreakdown(
                recency_weighted_reports=1.0,
                negative_share=1.0,
                urgency_multiplier=u_mult,
                formula="Rw × N × U"
            )
        )

    total_reports = len(reports)
    recent_count = 0
    negative_count = 0

    seven_days_ago = reference_time - timedelta(days=7)

    for r in reports:
        # Check created_at timestamp
        created_at = r.get("created_at")
        if isinstance(created_at, str):
            try:
                created_at = datetime.fromisoformat(created_at.replace("Z", "+00:00"))
            except ValueError:
                created_at = reference_time

        if created_at and created_at.tzinfo is None:
            created_at = created_at.replace(tzinfo=timezone.utc)

        # Recency weighting
        if created_at and created_at >= seven_days_ago:
            recent_count += 1

        # Check negative sentiment
        sentiment = r.get("sentiment", "negative")
        if str(sentiment).lower() == "negative":
            negative_count += 1

    u_mult = URGENCY_MAP.get(highest_urgency.lower(), 1.0)
    return priority_from_counts(total_reports, recent_count, negative_count, u_mult)


def priority_from_counts(total: int, recent: int, negative: int, urgency_multiplier: float) -> PriorityResult:
    rw = recent + (total - recent) * 0.5
    n_share = negative / total if total else 0.0
    return PriorityResult(
        priority_score=round(rw * n_share * urgency_multiplier, 2),
        breakdown=PriorityBreakdown(
            recency_weighted_reports=round(rw, 2),
            negative_share=round(n_share, 4),
            urgency_multiplier=urgency_multiplier,
            formula="Rw × N × U"
        )
    )
