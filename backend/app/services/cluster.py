import os
import math
from typing import List, Dict, Any, Optional
from pydantic import BaseModel, Field

DEFAULT_THRESHOLD = float(os.getenv("CLUSTERING_THRESHOLD", "0.65"))

_embedding_model = None

def get_embedding_model():
    global _embedding_model
    if _embedding_model is None:
        from fastembed import TextEmbedding
        # Load all-MiniLM-L6-v2 model via fastembed
        _embedding_model = TextEmbedding(model_name="sentence-transformers/all-MiniLM-L6-v2")
    return _embedding_model

def compute_embedding(text: str) -> List[float]:
    """Generates a normalized 384-dim embedding vector using fastembed (ONNX)."""
    if not text or not text.strip():
        return [0.0] * 384
    model = get_embedding_model()
    embeddings = list(model.embed([text]))
    vec = [float(x) for x in embeddings[0]]
    return vec

def cosine_similarity(v1: List[float], v2: List[float]) -> float:
    """Computes cosine similarity between two float vectors."""
    if not v1 or not v2 or len(v1) != len(v2):
        return 0.0
    dot_product = sum(a * b for a, b in zip(v1, v2))
    norm_v1 = math.sqrt(sum(a * a for a in v1))
    norm_v2 = math.sqrt(sum(b * b for b in v2))
    if norm_v1 == 0 or norm_v2 == 0:
        return 0.0
    return dot_product / (norm_v1 * norm_v2)

class ClusterMatchResult(BaseModel):
    should_join: bool
    matched_issue_id: Optional[str] = None
    similarity_score: float = 0.0
    embedding: List[float] = Field(default_factory=list)

def cluster_aspect(
    aspect_text: str,
    aspect_category: str,
    aspect_location_id: Optional[str],
    open_issues: List[Dict[str, Any]],
    threshold: float = DEFAULT_THRESHOLD
) -> ClusterMatchResult:
    """
    Clusters an aspect against existing open issues in the SAME category and location.

    open_issues is a list of dicts, each containing:
      - 'id': str
      - 'category': str
      - 'location_id': str
      - 'centroid': List[float] or 'title': str
      - 'status': str ("open", "in_progress", etc.)

    Returns ClusterMatchResult with should_join=True if similarity >= threshold.
    """
    aspect_emb = compute_embedding(aspect_text)

    best_match_id: Optional[str] = None
    max_similarity: float = -1.0

    for issue in open_issues:
        # Strict filtering: only compare against open issues in the SAME category and location
        issue_cat = issue.get("category", "")
        issue_loc = issue.get("location_id", "")

        if aspect_category.lower() != str(issue_cat).lower():
            continue
        if aspect_location_id and str(issue_loc) != str(aspect_location_id):
            continue

        centroid = issue.get("centroid") or issue.get("embedding")
        if not centroid and issue.get("title"):
            centroid = compute_embedding(issue["title"])

        if centroid:
            sim = cosine_similarity(aspect_emb, centroid)
            if sim > max_similarity:
                max_similarity = sim
                best_match_id = str(issue["id"])

    if max_similarity >= threshold and best_match_id is not None:
        return ClusterMatchResult(
            should_join=True,
            matched_issue_id=best_match_id,
            similarity_score=round(max_similarity, 4),
            embedding=aspect_emb
        )

    return ClusterMatchResult(
        should_join=False,
        matched_issue_id=None,
        embedding=aspect_emb
    )

def compute_updated_centroid(current_centroid: List[float], current_count: int, new_embedding: List[float]) -> List[float]:
    """
    Pure-function helper to recalculate an issue centroid when a new aspect joins.
    Formula: updated_i = (current_i * count + new_i) / (count + 1)
    """
    if not current_centroid:
        return new_embedding
    if not new_embedding or len(current_centroid) != len(new_embedding):
        return current_centroid

    total_count = current_count + 1
    updated = [
        (c * current_count + n) / total_count
        for c, n in zip(current_centroid, new_embedding)
    ]
    return updated
