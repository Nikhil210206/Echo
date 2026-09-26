import os
import re
import json
from typing import Optional
from fastapi import APIRouter, HTTPException
from app.schemas import AskQueryRequest, AskFilterResult

router = APIRouter(prefix="/api", tags=["ask"])

def parse_ask_query_fallback(query: str) -> AskFilterResult:
    """Deterministic fallback natural-language query parser into filter chips."""
    q_lower = query.lower()

    sentiment: Optional[str] = None
    if "negative" in q_lower or "bad" in q_lower or "complaint" in q_lower:
        sentiment = "negative"
    elif "positive" in q_lower or "good" in q_lower or "praise" in q_lower:
        sentiment = "positive"

    category: Optional[str] = None
    for cat in ["mess", "hostel", "infrastructure", "wifi", "transport", "library", "academics"]:
        if cat in q_lower or (cat == "wifi" and ("wi-fi" in q_lower or "internet" in q_lower)):
            category = cat if cat != "wifi" else "infrastructure"
            break

    date_range: Optional[str] = None
    if "this week" in q_lower or "last 7 days" in q_lower:
        date_range = "this_week"
    elif "today" in q_lower or "24 hours" in q_lower:
        date_range = "today"
    elif "this month" in q_lower:
        date_range = "this_month"

    return AskFilterResult(
        q=query,
        sentiment=sentiment,
        category=category,
        location=None,
        date_range=date_range,
        status="open" if "open" in q_lower else None
    )

@router.post("/ask", response_model=AskFilterResult)
async def ask_query_endpoint(body: AskQueryRequest):
    """
    Tier 2 Ask endpoint:
    Converts natural-language queries into structured search filter chips.
    """
    if not body.query or not body.query.strip():
        raise HTTPException(status_code=400, detail="Query cannot be empty")

    query_text = body.query.strip()
    api_key = os.environ.get("GEMINI_API_KEY")

    if api_key:
        try:
            from google import genai
            client = genai.Client(api_key=api_key)
            prompt = f"""Convert this natural language feedback query into search filters JSON.
Query: "{query_text}"

Return JSON matching:
{{
  "q": "search term or original query",
  "sentiment": "positive|negative|neutral|null",
  "category": "mess|hostel|infrastructure|transport|library|academics|null",
  "location": "location name or null",
  "date_range": "today|this_week|this_month|null",
  "status": "open|resolved|null"
}}
Return raw JSON only."""

            response = client.models.generate_content(
                model='gemini-2.5-flash',
                contents=prompt
            )
            if response and response.text:
                cleaned = response.text.strip("`").strip()
                if cleaned.lower().startswith("json"):
                    cleaned = cleaned[4:].strip()
                parsed = json.loads(cleaned)
                return AskFilterResult(**parsed)
        except Exception:
            pass

    return parse_ask_query_fallback(query_text)
