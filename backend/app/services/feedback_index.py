"""Build versioned text embeddings with the same MiniLM model used for clustering."""
import logging
import math
from concurrent.futures import ThreadPoolExecutor
from hashlib import sha256
from threading import BoundedSemaphore
from time import monotonic

from app.models import Feedback, FeedbackKind, FeedbackStatus
from app.services.cluster import compute_embedding

logger = logging.getLogger(__name__)
DIMENSIONS = 384
MODEL_VERSION = "minilm-l6-v2-v1"
_executor = ThreadPoolExecutor(max_workers=2, thread_name_prefix="echo-embedding")
_slots = BoundedSemaphore(2)


class EmbeddingUnavailable(RuntimeError):
    pass


def embed(text: str) -> list[float]:
    vector = compute_embedding(text)
    if len(vector) != DIMENSIONS or not all(map(math.isfinite, vector)) or not any(vector):
        raise EmbeddingUnavailable("Invalid embedding")
    return vector


def embed_with_timeout(text: str, timeout: float = 4) -> list[float]:
    if timeout <= 0 or not _slots.acquire(blocking=False):
        raise EmbeddingUnavailable("Embedding capacity unavailable")
    try:
        future = _executor.submit(embed, text)
    except RuntimeError:
        _slots.release()
        raise EmbeddingUnavailable("Embedding worker unavailable") from None
    future.add_done_callback(lambda _: _slots.release())
    try:
        return future.result(timeout=timeout)
    except Exception as exc:
        logger.warning("embedding_failed error_type=%s", type(exc).__name__)
        raise EmbeddingUnavailable("Embedding unavailable") from None


def text_digest(text: str) -> str:
    return sha256(text.encode("utf-8")).hexdigest()


def update_feedback_embedding(feedback: Feedback, *, strict: bool = False, force: bool = False) -> bool:
    text = feedback.text_redacted
    eligible = feedback.status == FeedbackStatus.approved and feedback.kind == FeedbackKind.text
    if not eligible or not text or not text.strip():
        feedback.search_embedding = None
        feedback.search_embedding_key = None
        return False

    key = f"{MODEL_VERSION}:{text_digest(text)}"
    if not force and feedback.search_embedding_key == key and feedback.search_embedding is not None:
        return False

    started = monotonic()
    feedback.search_embedding = None
    feedback.search_embedding_key = None
    try:
        feedback.search_embedding = embed(text) if strict else embed_with_timeout(text)
    except EmbeddingUnavailable:
        # Preserve the primary submission/moderation workflow. Backfill can retry this row.
        if strict:
            raise
        return False
    feedback.search_embedding_key = key
    logger.info("feedback_embedding_indexed latency_ms=%.1f", (monotonic() - started) * 1000)
    return True
