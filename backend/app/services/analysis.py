from app.schemas import AnalysisPipelineResult, ModerationFlags
from app.services.redact import redact_pii
from app.services.moderation import moderate_text
from app.services.fallback import analyze_fallback
from app.services.llm import analyze_llm

async def run_analysis_pipeline(raw_text: str) -> AnalysisPipelineResult:
    """
    Main feedback analysis pipeline:
    1. PII Redaction
    2. Moderation checks (profanity masking & flag checks)
    3. LLM aspect extraction (with fallback to VADER/keyword lexicon)
    4. Sarcasm handling (mocking praise is negative and goes to moderation)
    5. Overall sentiment derivation
    6. Returns structured AnalysisPipelineResult
    """
    if not raw_text or not raw_text.strip():
        # Handle empty input gracefully
        mod = moderate_text(raw_text)
        return AnalysisPipelineResult(
            raw_text=raw_text,
            text_redacted=raw_text,
            aspects=[],
            overall_sentiment="neutral",
            analyzed_by="lexicon",
            moderation=mod
        )

    # 1. PII Redaction
    text_redacted = redact_pii(raw_text)

    # 2. Moderation & profanity masking
    moderation: ModerationFlags = moderate_text(text_redacted)
    processed_text = moderation.masked_text if moderation.masked_text else text_redacted

    # 3. LLM analysis attempt
    analyzed_by = "llm"
    aspects = await analyze_llm(processed_text, timeout=3.0)

    # 4. Fallback if LLM failed or yielded no results
    if aspects is None or len(aspects) == 0:
        analyzed_by = "lexicon"
        aspects = analyze_fallback(processed_text)

    # 5. Sarcasm the LLM spotted but the moderation patterns missed still goes to review,
    # and a mocking aspect is never counted as praise
    for a in aspects:
        if a.sarcastic:
            a.sentiment = "negative"
    if any(a.sarcastic for a in aspects) and not moderation.is_sarcastic:
        moderation.is_sarcastic = True
        moderation.flagged = True
        moderation.reasons.append("Sarcastic or mocking, not a genuine compliment")

    # 6. Determine overall sentiment from aspects
    negative_count = sum(1 for a in aspects if a.sentiment == "negative")
    positive_count = sum(1 for a in aspects if a.sentiment == "positive")

    if negative_count > positive_count:
        overall_sentiment = "negative"
    elif positive_count > negative_count:
        overall_sentiment = "positive"
    else:
        overall_sentiment = "neutral" if aspects else "neutral"

    # Guarantee that raw PII cannot leak to persistence-facing analysis result
    return AnalysisPipelineResult(
        raw_text=processed_text,
        text_redacted=processed_text,
        aspects=aspects,
        overall_sentiment=overall_sentiment,
        analyzed_by=analyzed_by,
        moderation=moderation
    )