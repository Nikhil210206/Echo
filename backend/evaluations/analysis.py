"""Evaluate the Echo analysis pipeline on synthetic examples."""
import argparse
import asyncio
from collections import Counter
import json
from math import ceil
import os
from pathlib import Path
from statistics import mean, median
from time import perf_counter

from dotenv import load_dotenv

from app.services.analysis import run_analysis_pipeline
from app.services.llm import OPENAI_COMPATIBLE_PROVIDERS, attempt_analysis

DATA = Path(__file__).with_name("analysis_cases.json")
URGENCY = ("normal", "high", "critical")
PROVIDERS = {name: (key, model_var, default) for name, key, model_var, _, default in OPENAI_COMPATIBLE_PROVIDERS}
PROVIDERS["gemini"] = ("GEMINI_API_KEY", None, "gemini-2.5-flash")
FIELDS = ("sentiment", "categories", "urgency", "sarcasm", "off_topic")


def features(result):
    return {
        "sentiment": result.overall_sentiment,
        "categories": sorted({aspect.category for aspect in result.aspects}),
        "urgency": max((aspect.urgency for aspect in result.aspects), key=URGENCY.index, default="normal"),
        "sarcasm": result.moderation.is_sarcastic,
        "off_topic": result.moderation.is_off_topic,
    }


def class_metrics(truth, predicted, multilabel=False):
    actual = [set(value) if multilabel else {value} for value in truth]
    observed = [set(value) if multilabel else {value} for value in predicted]
    pairs = list(zip(actual, observed, strict=True))
    classes = set().union(*actual, *observed)
    f1 = []
    for label in classes:
        true_positive = sum(label in left and label in right for left, right in pairs)
        actual_positive = sum(label in row for row in actual)
        predicted_positive = sum(label in row for row in observed)
        f1.append(2 * true_positive / (actual_positive + predicted_positive))
    return {"accuracy": round(mean(left == right for left, right in pairs), 4),
            "macro_f1": round(mean(f1), 4) if f1 else None}


async def evaluate(cases, selected=None):
    outcomes = Counter()
    timings = []
    evaluated = []
    inspected = []
    valid_rows = []
    fallbacks = 0

    async def analyzer(text):
        if selected is None:
            return None
        attempt = await attempt_analysis(text, selected=selected)
        outcomes[attempt.outcome] += 1
        return attempt.aspects

    for case in cases:
        started = perf_counter()
        result = await run_analysis_pipeline(case["text"], analyzer=analyzer)
        timings.append((perf_counter() - started) * 1000)
        predicted = features(result)
        expected = case["expected"]
        evaluated.append((expected, predicted))
        if result.analyzed_by == "llm":
            valid_rows.append((expected, predicted))
        fallbacks += result.analyzed_by == "lexicon"
        fields = [name for name in FIELDS if (
            set(expected[name]) != set(predicted[name]) if name == "categories" else expected[name] != predicted[name]
        )]
        if fields:
            inspected.append({"id": case["id"], "mismatched_fields": fields})

    def metrics(rows):
        return {
            name: class_metrics([expected[name] for expected, _ in rows], [actual[name] for _, actual in rows],
                                multilabel=name == "categories")
            for name in FIELDS
        }

    report = {
        "examples": len(cases),
        "model": os.getenv(PROVIDERS[selected][1], PROVIDERS[selected][2])
                 if selected and PROVIDERS[selected][1] else (PROVIDERS[selected][2] if selected else "VADER + Echo lexicon"),
        "metrics": metrics(evaluated),
        "analysis_outcomes": dict(outcomes),
        "invalid_output_rate": outcomes["invalid_output"] / len(cases) if selected else None,
        "fallback_rate": fallbacks / len(cases) if selected else None,
        "latency_ms": {"p50": round(median(timings), 2), "p95": round(sorted(timings)[ceil(len(timings) * .95) - 1], 2)},
        "mismatches": inspected,
    }
    if selected:
        report["valid_model_examples"] = len(valid_rows)
        report["metrics_on_valid_model_examples"] = metrics(valid_rows) if valid_rows else None
    return report


def main():
    load_dotenv()
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--dataset", type=Path, default=DATA)
    parser.add_argument("--live", action="store_true", help="Opt in to paid/network provider calls")
    parser.add_argument("--provider", choices=tuple(PROVIDERS))
    args = parser.parse_args()
    if args.provider and not args.live:
        parser.error("--provider requires --live")
    cases = json.loads(args.dataset.read_text(encoding="utf-8"))
    if not cases:
        parser.error("Dataset is empty")
    report = {"dataset": str(args.dataset.name), "baseline": asyncio.run(evaluate(cases)), "live": "not run"}
    if args.live:
        selected = args.provider or next((name for name, (key, _, _) in PROVIDERS.items() if os.getenv(key)), None)
        if selected and os.getenv(PROVIDERS[selected][0]):
            report["live"] = {selected: asyncio.run(evaluate(cases, selected))}
        else:
            report["live"] = "not run (missing provider credentials)"
    print(json.dumps(report, indent=2, ensure_ascii=True))


if __name__ == "__main__":
    main()
