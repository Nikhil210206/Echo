from typing import List, Optional, Literal
from pydantic import BaseModel, Field

class AspectResult(BaseModel):
    aspect: str = Field(..., description="The feature or topic being discussed (e.g. food, Wi-Fi)")
    category: Literal[
        "mess",
        "hostel",
        "infrastructure",
        "transport",
        "library",
        "academics",
        "general"
    ]
    sentiment: Literal["positive", "negative", "neutral"]
    urgency: Literal["critical", "high", "normal"]
    evidence_span: str = Field(..., description="Exact quote/span from text supporting this aspect")
    sarcastic: bool = Field(False, description="Mocking praise that is really a complaint (e.g. 'good for donkeys')")

class ModerationFlags(BaseModel):
    flagged: bool = False
    reasons: List[str] = Field(default_factory=list)
    is_spam: bool = False
    is_gibberish: bool = False
    is_duplicate_flood: bool = False
    is_off_topic: bool = False
    is_abusive: bool = False
    is_sarcastic: bool = False
    masked_text: str = ""

class AnalysisPipelineResult(BaseModel):
    raw_text: str
    text_redacted: str
    aspects: List[AspectResult]
    overall_sentiment: str
    analyzed_by: str  # "llm" or "lexicon"
    moderation: ModerationFlags

class PriorityBreakdown(BaseModel):
    recency_weighted_reports: float
    negative_share: float
    urgency_multiplier: float
    formula: str = "Rw × N × U"

class PriorityResult(BaseModel):
    priority_score: float
    breakdown: PriorityBreakdown

class SpikeResult(BaseModel):
    category: str
    location: str
    c72h: int
    baseline_b: float
    spike_ratio: float
    is_spike: bool
    display_text: str

class CategoryTrendResult(BaseModel):
    category: str
    current_week_count: int
    previous_week_count: int
    percentage_change: float
    display_text: str

class AskQueryRequest(BaseModel):
    query: str

class AskFilterResult(BaseModel):
    q: Optional[str] = None
    sentiment: Optional[str] = None
    category: Optional[str] = None
    location: Optional[str] = None
    date_range: Optional[str] = None
    status: Optional[str] = None