"""Run deterministic assistant tests or opt in to a real Groq run on synthetic records."""
import argparse
import json
import os
from pathlib import Path
import subprocess
import sys
from time import perf_counter

from dotenv import load_dotenv

DATA = Path(__file__).with_name("assistant_cases.json")


class TracedProvider:
    def __init__(self, provider):
        self.provider = provider
        self.tools = []
        self.evidence = set()
        self.facts = set()
        self.excerpts = []

    def chat(self, messages, tools, *, timeout):
        for message in messages:
            if message["role"] == "tool":
                payload = json.loads(message["content"])
                self.evidence.update(row["source_id"] for row in payload["untrusted_evidence"])
                self.excerpts.extend(row["excerpt"] or "" for row in payload["untrusted_evidence"])
                if payload["statistic"]:
                    self.facts.add(payload["statistic"]["fact_id"])
        result = self.provider.chat(messages, tools, timeout=timeout)
        self.tools.extend(call.function.name for call in (result.tool_calls or []))
        return result


def run_live(provider, cases):
    os.environ.setdefault("JWT_SECRET", "unused-local-evaluation")
    os.environ.setdefault("DATABASE_URL", "sqlite:///unused-evaluation.db")
    from app.models import UserRole
    from app.routers.assistant import _provider_history
    from app.services.assistant import answer_question
    from app.services.assistant_statistics import StatisticsRequest
    from app.services.retrieval import Access
    from evaluations.retrieval import DATA as CORPUS, get_embedding_model, synthetic_database

    get_embedding_model()
    results = []
    with synthetic_database(json.loads(CORPUS.read_text(encoding="utf-8"))) as db:
        for case in cases:
            history = []
            actor = Access(case["actor"], UserRole(case["actor"]))
            for number, turn in enumerate(case["turns"], 1):
                tracer = TracedProvider(provider)
                started = perf_counter()
                request = StatisticsRequest.model_validate(turn["statistics"]) if "statistics" in turn else None
                result = answer_question(db, actor, turn["question"], _provider_history(history[-8:]), tracer, request)
                sources = {source.source_id for source in result.sources}
                fact = result.statistic
                needs_grounded = "any_source" in turn or "total" in turn
                checks = {
                    "expected_tools_called": set(turn.get("tools", [])) <= set(tracer.tools),
                    "grounded_mode": result.mode == "grounded" if needs_grounded else None,
                    "selected_sources_were_in_tool_evidence": sources <= tracer.evidence if result.mode == "grounded" else None,
                    "expected_source": bool(sources.intersection(turn["any_source"])) if "any_source" in turn else None,
                    "forbidden_sources_absent": not sources.intersection(turn["forbidden"]) if "forbidden" in turn else None,
                    "insufficient_evidence": result.reason == "insufficient_evidence" if turn.get("insufficient") else None,
                    "recorded_total_matches": bool(fact and fact.fact_id in tracer.facts and fact.total == turn["total"]
                                                   and fact.request == request) if "total" in turn else None,
                    "injection_phrase_absent_from_model_excerpt": all(
                        turn["forbidden_phrase"] not in text.casefold() for text in tracer.excerpts)
                    if "forbidden_phrase" in turn else None,
                }
                results.append({"case": case["id"], "turn": number, "mode": result.mode, "reason": result.reason,
                                "tools": tracer.tools, "source_ids": sorted(sources),
                                "statistic": fact.model_dump(mode="json") if fact else None,
                                "latency_ms": round((perf_counter() - started) * 1000, 2), "checks": checks})
                history.extend([
                    {"role": "user", "text": turn["question"]},
                    {"role": "assistant", "result": result.model_dump(mode="json")},
                ])
    return {"live": True, "model": provider.model, "cases": results}


def main():
    cases = json.loads(DATA.read_text(encoding="utf-8"))
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--live", action="store_true", help="Opt in to paid Groq requests on the synthetic corpus")
    parser.add_argument("--case", action="append", choices=[case["id"] for case in cases],
                        help="Run one synthetic live case. Repeat to run multiple cases.")
    args = parser.parse_args()
    if not args.live:
        if args.case:
            parser.error("--case requires --live")
        return subprocess.run([sys.executable, "-m", "pytest", "-q", "tests/test_assistant_search.py"],
                              cwd=DATA.parent.parent, check=False).returncode

    load_dotenv()
    from app.services.assistant_provider import configured_provider

    provider = configured_provider()
    if provider is None:
        print(json.dumps({"live": "not run (missing assistant model or credentials)"}))
        return 2
    selected = [case for case in cases if not args.case or case["id"] in args.case]
    report = run_live(provider, selected)
    print(json.dumps(report, indent=2, ensure_ascii=True))
    return int(any(value is False for turn in report["cases"] for value in turn["checks"].values()))


if __name__ == "__main__":
    raise SystemExit(main())
