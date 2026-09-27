import pytest
from app.services.cluster import compute_embedding, cosine_similarity, cluster_aspect, compute_updated_centroid

def test_embedding_generation():
    emb = compute_embedding("Wi-Fi network connection down in Block 3")
    assert isinstance(emb, list)
    assert len(emb) == 384

def test_cosine_similarity_identical():
    v1 = [1.0, 0.0, 0.0]
    v2 = [1.0, 0.0, 0.0]
    assert cosine_similarity(v1, v2) == 1.0

def test_compute_updated_centroid():
    current = [1.0, 3.0]
    new_emb = [3.0, 5.0]
    updated = compute_updated_centroid(current, 1, new_emb)
    assert updated == [2.0, 4.0]

def test_cluster_aspect_matching_existing_issue():
    open_issues = [
        {
            "id": "issue-101",
            "category": "infrastructure",
            "location_id": "loc-block3",
            "title": "Wi-Fi is completely broken in Hostel Block 3",
        }
    ]

    result = cluster_aspect(
        aspect_text="Wi-Fi in Block 3 has been dead for 3 days",
        aspect_category="infrastructure",
        aspect_location_id="loc-block3",
        open_issues=open_issues,
        threshold=0.60
    )

    assert result.should_join is True
    assert result.matched_issue_id == "issue-101"
    assert result.similarity_score >= 0.60

def test_cluster_aspect_different_category_no_match():
    open_issues = [
        {
            "id": "issue-101",
            "category": "mess",
            "location_id": "loc-block3",
            "title": "Mess food is cold and unhygienic",
        }
    ]

    result = cluster_aspect(
        aspect_text="Wi-Fi in Block 3 has been dead for 3 days",
        aspect_category="infrastructure",
        aspect_location_id="loc-block3",
        open_issues=open_issues,
        threshold=0.65
    )

    assert result.should_join is False
    assert result.matched_issue_id is None
