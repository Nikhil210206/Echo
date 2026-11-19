# Echo evaluations

All included examples and expected labels were created synthetically for this repository. Run the commands from `backend/` in the project virtual environment.

```bash
pip install -r requirements.txt pytest
python -m evaluations.analysis
python -m evaluations.retrieval
python -m evaluations.assistant
```

## Feedback analysis

`analysis_cases.json` has 20 starter examples. It includes mixed reports, subtle sentiment, jokes and off-topic submissions, sarcasm, and attempts to direct the analyzer. Each row defines an expected overall sentiment, category set, maximum urgency and moderation labels. Category accuracy requires the entire set to match. Macro-F1 averages F1 over labels present in the judgments or predictions. Urgency is the highest urgency among emitted aspects, with normal as the default for an empty result.

The baseline runs Echo's normal redaction and moderation pipeline with the VADER/keyword analyzer. The live section reports classification metrics for the full pipeline and for the examples with valid model output. It also reports invalid or empty model output, provider errors/timeouts, the rate of lexicon fallback, and end-to-end p50/p95 latency. Rate denominators are all examples. Provider-output and fallback rates apply only to live runs.

To call a configured analysis provider on this synthetic dataset, opt in with `--live`. It can incur provider charges.

```bash
python -m evaluations.analysis --live --provider groq
# --provider also accepts xai or gemini. Omit it for Echo's usual provider precedence.
```

For a replacement dataset, keep the JSON shape and pass `--dataset path/to/file.json`. Use independently labeled, permissioned, redacted reports. Agree on written labeling rules and adjudicate disagreements, especially mixed feedback and ambiguous off-topic cases. Report the distribution of categories and labelers' agreement. Keep cases used to tune prompts or heuristics out of the final evaluation set.

## Retrieval

`retrieval_cases.json` fixes the locations, issue assignments and status, 18 reports, ten queries and per-document grades. Grade 2 is directly relevant and grade 1 is useful secondary evidence. Missing document IDs have grade 0. Cases include paraphrases, multiple relevant reports, time and metadata filters, and a query with no eligible records.

The harness calls Echo's scoped search service with a disposable SQLite fixture and an exact cosine function. It uses real 384-dimensional MiniLM embeddings and the same eligibility, metadata filters and tie-breaks as PostgreSQL. The keyword comparison uses case-insensitive literal substring matching and newest-first order. The legacy UI retains its normal keyword endpoint. For a database-backed check, run the optional PostgreSQL test documented below.

- **Recall@5** is the fraction of positive-grade documents in the first five results.
- **MRR@5** averages the reciprocal rank of the first positive-grade result within five.
- **nDCG@5** uses grade gains of `2^grade - 1` and logarithmic rank discounts, normalized against the best ordering for each query.
- Queries with no positive judgments are reported through the separate empty-result check.

The recorded configuration used fastembed 0.9.1, model `sentence-transformers/all-MiniLM-L6-v2` (fastembed's Qdrant ONNX snapshot `d13954661f83248295ba75c1ed411eef3b7b936e`), and embedding version `minilm-l6-v2-v1`. For an offline rerun, install `fastembed==0.9.1`, prepare the model once, and point `FASTEMBED_CACHE_PATH` at that cache. With the model cached, set `HF_HUB_OFFLINE=1`.

```bash
python -c 'from app.services.cluster import get_embedding_model; get_embedding_model()'
python -m evaluations.retrieval
python -m evaluations.retrieval --keyword-only
```

Synthetic starter run, averaged over nine queries with relevant records:

| Method | Recall@5 | MRR@5 | nDCG@5 |
|---|---:|---:|---:|
| Keyword substring | 0.2500 | 0.3333 | 0.2508 |
| MiniLM exact cosine | 1.0000 | 1.0000 | 0.9589 |

Both methods returned zero hits for the one query with no matching records. Paraphrase-heavy cases and filters that narrow the results substantially make this a small diagnostic comparison. The local fixture latency includes local inference and query work. Production latency and quality require a representative corpus and a benchmark on the intended PostgreSQL instance.

## Assistant

`python -m evaluations.assistant` runs deterministic API tests with scripted tool-call responses and controlled vectors. It checks declared tools, rejected arguments, follow-up context, authorization, idempotency, failure paths, injected instructions, and rejection of unsupported, stale and differently scoped counts.

The live suite in `assistant_cases.json` calls Groq on the synthetic retrieval corpus. It reports tool selections, selected records, SQL count facts, and case-specific checks. The aggregate case passes the same explicit scope confirmation used by the UI. Configure `ASSISTANT_GROQ_API_KEY` and optionally `ASSISTANT_GROQ_MODEL`, then explicitly opt in with a small case selection or omit `--case` for the full suite.

```bash
python -m evaluations.assistant --live --case aggregate --case library-follow-up
```

Human review should check selection relevance, coverage, whether a follow-up respects the prior scope, and whether injected directives influenced tool choices. The response format displays reporter excerpts and server-owned facts. Model-selected record IDs do not establish whether a reporter's statement is true. A retrieval fallback fails a case requiring grounded selections. The live CLI exits 1 for failed checks and 2 when provider configuration is absent.

## PostgreSQL integration

Use a disposable PostgreSQL database with pgvector and no production data. Point `DATABASE_URL` at it and run `alembic upgrade head`. Set `ECHO_TEST_POSTGRES_URL` to that same test URL and run `python -m pytest -q tests/test_search_postgres.py`. The tests cover the actual vector operator, index lifecycle and scoped issue aggregation over an issue with more than 1,500 aspects. Their fixtures are rolled back at the end.
