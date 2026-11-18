import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { Empty, PageHead, Skeleton } from "@/components/admin/AdminShell";
import { EvidenceText } from "@/components/admin/EvidenceText";
import { IconSearch } from "@/components/admin/icons";
import { Reporter } from "@/components/admin/Reporter";
import { Button, ErrorNote, SentimentChip, Spinner, UrgencyTag } from "@/components/ui/kit";
import { api, USE_MOCKS } from "@/lib/api";
import { cn } from "@/lib/cn";
import { CATEGORIES, categoryLabel, timeAgo } from "@/lib/format";
import { gsap, useGSAP, prefersReducedMotion } from "@/lib/gsap";
import type { FeedbackHit, FeedbackQuery, FeedbackRecord, Location, Sentiment } from "@/lib/types";

const PAGE = 20;
const RANGES = [
  { v: "", l: "All time" },
  { v: "7", l: "7 days" },
  { v: "30", l: "30 days" },
];
const STATUSES = [
  { v: "", l: "Any issue status" },
  { v: "active", l: "Unresolved" },
  { v: "open", l: "Open" },
  { v: "acknowledged", l: "Acknowledged" },
  { v: "in_progress", l: "In progress" },
  { v: "resolved", l: "Resolved" },
  { v: "reopened", l: "Reopened" },
];

export default function Feedback() {
  const [params, setParams] = useSearchParams();
  const q = params.get("q") ?? "";
  const semantic = params.get("mode") === "semantic";
  const [text, setText] = useState(q);
  const [items, setItems] = useState<FeedbackRecord[] | null>(null);
  const [hits, setHits] = useState<FeedbackHit[] | null>(null);
  const [places, setPlaces] = useState<Location[]>([]);
  const [retry, setRetry] = useState(0);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const list = useRef<HTMLUListElement>(null);
  const generation = useRef(0);

  const query: FeedbackQuery = useMemo(
    () => ({
      q: q || undefined,
      sentiment: (params.get("sentiment") as Sentiment) || undefined,
      category: params.get("category") || undefined,
      location_id: params.get("location") || undefined,
      days: params.get("days") ? Number(params.get("days")) : undefined,
      issue_status: (params.get("issue_status") as FeedbackQuery["issue_status"]) || undefined,
      page_size: PAGE,
    }),
    [params, q],
  );
  const key = JSON.stringify({ query, semantic });

  const set = (k: string, v: string) => {
    const p = new URLSearchParams(params);
    if (v) p.set(k, v);
    else p.delete(k);
    setParams(p, { replace: true });
  };

  useEffect(() => {
    if (text.trim() === q) return;
    const t = setTimeout(() => setParams((previous) => {
      const updated = new URLSearchParams(previous);
      if (text.trim()) updated.set("q", text.trim());
      else updated.delete("q");
      return updated;
    }, { replace: true }), 300);
    return () => clearTimeout(t);
  }, [text, q, setParams]);

  useEffect(() => { setText(q); }, [q]);

  useEffect(() => {
    let alive = true;
    api.locations().then((rows) => { if (alive) setPlaces(rows); }).catch(() => {});
    return () => { alive = false; };
  }, [retry]);

  useEffect(() => {
    let alive = true;
    generation.current += 1;
    setItems(null);
    setHits(null);
    setPage(1);
    setError(null);
    setLoadingMore(false);
    if (semantic) {
      if (q && !USE_MOCKS) {
        api.semanticFeedback({
          q, sentiment: query.sentiment, category: query.category, location: query.location_id?.toString(),
          days: query.days, issue_status: query.issue_status,
        }).then((rows) => { if (alive) setHits(rows); })
          .catch((e: Error) => { if (alive) setError(e.message); });
      }
      return () => { alive = false; };
    }
    api
      .feedback({ ...query, page: 1 })
      .then((r) => {
        if (!alive) return;
        setItems(r.items);
        setTotal(r.total);
        setError(null);
      })
      .catch((e: Error) => alive && setError(e.message));
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, retry]);

  async function more() {
    const current = generation.current;
    setLoadingMore(true);
    try {
      const r = await api.feedback({ ...query, page: page + 1 });
      if (generation.current !== current) return;
      setItems((prev) => [...(prev ?? []), ...r.items]);
      setPage(page + 1);
    } catch (e) {
      if (generation.current === current) setError((e as Error).message);
    } finally {
      if (generation.current === current) setLoadingMore(false);
    }
  }

  useGSAP(
    () => {
      if (!items?.length || prefersReducedMotion()) return;
      gsap.fromTo(".fb-row", { y: 14, opacity: 0 }, { y: 0, opacity: 1, stagger: 0.025, duration: 0.5 });
    },
    { scope: list, dependencies: [key, !!items] },
  );

  const terms = q.toLowerCase().split(/\s+/).filter(Boolean);
  const active = [...params.keys()].some((k) => k !== "mode");

  return (
    <div>
      <PageHead
        eyebrow="Feedback search"
        title={
          <>
            Every <span className="serif-accent text-lilac">voice</span>
          </>
        }
      >
        <p className="font-mono text-sm text-bone/50">
          {semantic ? (hits && `${hits.length} ranked matches`) : (items && `${total} result${total === 1 ? "" : "s"}`)}
        </p>
      </PageHead>

      <div className="mb-4 flex items-center gap-3 rounded-full bg-ink-2 px-5 ring-1 ring-bone/10 focus-within:ring-2 focus-within:ring-lilac">
        <IconSearch className="shrink-0 text-bone/40" />
        <label htmlFor="q" className="sr-only">
          Search feedback
        </label>
        <input
          id="q"
          value={text}
          maxLength={500}
          onChange={(e) => setText(e.target.value)}
          placeholder={semantic ? "Describe a problem, e.g. trouble getting online" : "Search what people wrote, e.g. wifi, cold dinner, route 12"}
          className="h-14 min-w-0 flex-1 bg-transparent text-lg outline-none placeholder:text-bone/30"
        />
        {text && (
          <button onClick={() => setText("")} className="text-sm text-bone/40 hover:text-bone">
            Clear
          </button>
        )}
      </div>

      <div className="mb-6 flex flex-wrap items-center gap-2">
        <Seg
          label="Search mode"
          value={semantic ? "semantic" : ""}
          options={[{ v: "", l: "Keyword" }, { v: "semantic", l: "Semantic" }]}
          onChange={(v) => set("mode", v)}
        />
        <Seg
          label="Sentiment"
          value={params.get("sentiment") ?? ""}
          options={[
            { v: "", l: "Any" },
            { v: "negative", l: "Negative" },
            { v: "neutral", l: "Neutral" },
            { v: "positive", l: "Positive" },
          ]}
          onChange={(v) => set("sentiment", v)}
        />
        <Select label="Topic" value={params.get("category") ?? ""} onChange={(v) => set("category", v)} options={[{ v: "", l: "All topics" }, ...CATEGORIES.map((c) => ({ v: c, l: categoryLabel(c) }))]} />
        <Select
          label="Place"
          value={params.get("location") ?? ""}
          onChange={(v) => set("location", v)}
          options={[{ v: "", l: "All places" }, ...places.map((l) => ({ v: String(l.id), l: l.name }))]}
        />
        <Seg label="Range" value={params.get("days") ?? ""} options={RANGES} onChange={(v) => set("days", v)} />
        <Select label="Issue status" value={params.get("issue_status") ?? ""} options={STATUSES}
          onChange={(v) => set("issue_status", v)} />
        {active && (
          <button
            onClick={() => {
              setText("");
              setParams(semantic ? { mode: "semantic" } : {}, { replace: true });
            }}
            className="ml-auto text-sm text-lilac hover:text-bone"
          >
            Reset filters
          </button>
        )}
      </div>

      {error && (
        <div className="mb-4 flex items-center gap-3">
          <ErrorNote>{error}</ErrorNote>
          <Button variant="ghost" onClick={() => setRetry((value) => value + 1)}>Retry</Button>
        </div>
      )}

      {semantic ? (
        USE_MOCKS ? <Empty title="Semantic search needs the Echo API">Set VITE_USE_MOCKS=false to connect to a backend.</Empty> :
        !q ? <Empty title="Search by meaning">Describe the feedback you want to find.</Empty> :
        hits ? (
          hits.length ? <ul className="space-y-2">{hits.map((hit) => (
            <li key={hit.id} className="rounded-[1.5rem] bg-ink-2 p-5 ring-1 ring-bone/[0.06]">
              <p className="break-words text-bone/85">{hit.excerpt}</p>
              <div className="mt-3 flex flex-wrap gap-3 text-xs text-bone/55">
                <Link className="text-lilac hover:underline" to={`/admin/feedback/${hit.id}`}>Open feedback</Link>
                <span>{hit.location_name} · {timeAgo(hit.created_at)}</span>
                {hit.similarity !== null && <span title="Cosine similarity from −1 to 1. Higher means closer in meaning.">
                  Cosine similarity {hit.similarity.toFixed(3)}
                </span>}
                {hit.issues.map((issue) => <Link key={issue.id} className="text-lilac hover:underline"
                  to={`/admin/issues/${issue.id}`}>Issue · {issue.status.replaceAll("_", " ")}</Link>)}
              </div>
            </li>
          ))}</ul> : <Empty title="No semantic matches">Widen the filters or try a keyword search.</Empty>
        ) : !error && <Skeleton className="h-24" />
      ) : !items ? (
        !error &&
        <div className="space-y-2">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-24" />
          ))}
        </div>
      ) : items.length === 0 ? (
        <Empty title="Nothing matches">Try fewer words, or widen the range and topic.</Empty>
      ) : (
        <>
          <ul ref={list} className="space-y-2">
            {items.map((f) => (
              <li key={f.id} className="fb-row rounded-[1.5rem] bg-ink-2 p-5 ring-1 ring-bone/[0.06]">
                {f.kind === "me_too" ? (
                  <p className="text-bone/60">
                    <span className="font-medium text-lilac">Me too</span> on {categoryLabel(f.aspects[0]?.category)} at {f.location_name}
                  </p>
                ) : (
                  <EvidenceText
                    text={f.text_redacted ?? ""}
                    terms={terms}
                    spans={f.aspects.map((a) => ({ text: a.evidence_span, sentiment: a.sentiment, label: categoryLabel(a.category) }))}
                  />
                )}
                <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2 text-xs text-bone/45">
                  {f.aspects.map((a) => (
                    <span key={a.id} className="flex items-center gap-1.5 rounded-full bg-bone/[0.05] px-2.5 py-1">
                      <span className="text-bone/80">{categoryLabel(a.category)}</span>
                      <SentimentChip sentiment={a.sentiment} className="!text-[0.7rem] text-bone/55" />
                      <UrgencyTag urgency={a.urgency} />
                      {a.issue_id && <span className="font-mono text-lilac">#{a.issue_id}</span>}
                    </span>
                  ))}
                  <Reporter name={f.reporter_name} phone={f.reporter_phone} />
                  {f.flags.includes("sarcasm") && <span className="rounded bg-amber/15 px-1.5 py-0.5 text-amber">sarcasm</span>}
                  {f.flags.includes("profanity_masked") && <span className="rounded bg-amber/15 px-1.5 py-0.5 text-amber">profanity masked</span>}
                  {f.status !== "approved" && <span className="rounded bg-signal/15 px-1.5 py-0.5 text-signal">{f.status}</span>}
                  <span className={cn("rounded bg-bone/[0.06] px-1.5 py-0.5 font-mono text-[0.65rem]", f.kind === "me_too" && "hidden")}>
                    {f.analyzed_by === "llm" ? "LLM" : "Lexicon"}
                  </span>
                  <span className="ml-auto">
                    {f.location_name} · {timeAgo(f.created_at)}
                  </span>
                </div>
              </li>
            ))}
          </ul>
          {items.length < total && (
            <div className="mt-6 flex justify-center">
              <Button variant="ghost" onClick={more} disabled={loadingMore}>
                {loadingMore ? <Spinner /> : `Show more · ${total - items.length} left`}
              </Button>
            </div>
          )}
        </>
      )}
    </div>
  );
}

function Seg({ label, value, options, onChange }: { label: string; value: string; options: { v: string; l: string }[]; onChange: (v: string) => void }) {
  return (
    <div className="flex items-center gap-1 rounded-full bg-ink-2 p-1 ring-1 ring-bone/[0.06]" role="group" aria-label={label}>
      {options.map((o) => (
        <button
          key={o.v}
          onClick={() => onChange(o.v)}
          aria-pressed={value === o.v}
          className={cn("h-9 rounded-full px-3.5 text-sm transition-colors", value === o.v ? "bg-bone text-ink" : "text-bone/55 hover:text-bone")}
        >
          {o.l}
        </button>
      ))}
    </div>
  );
}

function Select({ label, value, options, onChange }: { label: string; value: string; options: { v: string; l: string }[]; onChange: (v: string) => void }) {
  return (
    <select
      aria-label={label}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className={cn("h-11 rounded-full bg-ink-2 px-4 text-sm outline-none ring-1 ring-bone/[0.06] focus:ring-lilac", value ? "text-bone" : "text-bone/55")}
    >
      {options.map((o) => (
        <option key={o.v} value={o.v}>
          {o.l}
        </option>
      ))}
    </select>
  );
}
