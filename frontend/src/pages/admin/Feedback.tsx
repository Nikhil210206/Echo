import { useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { Empty, PageHead, Skeleton } from "@/components/admin/AdminShell";
import { EvidenceText } from "@/components/admin/EvidenceText";
import { IconSearch } from "@/components/admin/icons";
import { Button, ErrorNote, SentimentChip, Spinner, UrgencyTag } from "@/components/ui/kit";
import { api } from "@/lib/api";
import { cn } from "@/lib/cn";
import { CATEGORIES, categoryLabel, timeAgo } from "@/lib/format";
import { gsap, useGSAP, prefersReducedMotion } from "@/lib/gsap";
import type { FeedbackQuery, FeedbackRecord, Sentiment } from "@/lib/types";
import { locations } from "@/mocks/store";

const PAGE = 20;
const RANGES = [
  { v: "", l: "All time" },
  { v: "7", l: "7 days" },
  { v: "30", l: "30 days" },
];

export default function Feedback() {
  const [params, setParams] = useSearchParams();
  const q = params.get("q") ?? "";
  const [text, setText] = useState(q);
  const [items, setItems] = useState<FeedbackRecord[] | null>(null);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const list = useRef<HTMLUListElement>(null);

  const query: FeedbackQuery = useMemo(
    () => ({
      q: q || undefined,
      sentiment: (params.get("sentiment") as Sentiment) || undefined,
      category: params.get("category") || undefined,
      location_id: params.get("location") ? Number(params.get("location")) : undefined,
      days: params.get("days") ? Number(params.get("days")) : undefined,
      page_size: PAGE,
    }),
    [params, q],
  );
  const key = JSON.stringify(query);

  const set = (k: string, v: string) => {
    const p = new URLSearchParams(params);
    if (v) p.set(k, v);
    else p.delete(k);
    setParams(p, { replace: true });
  };

  // Debounce typing into the URL
  useEffect(() => {
    if (text === q) return;
    const t = setTimeout(() => set("q", text.trim()), 300);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [text]);

  useEffect(() => {
    let alive = true;
    setItems(null);
    setPage(1);
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
  }, [key]);

  async function more() {
    setLoadingMore(true);
    try {
      const r = await api.feedback({ ...query, page: page + 1 });
      setItems((prev) => [...(prev ?? []), ...r.items]);
      setPage(page + 1);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoadingMore(false);
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
  const active = [...params.keys()].filter((k) => k !== "q").length + (q ? 1 : 0);

  return (
    <div>
      <PageHead
        eyebrow="Full-text search"
        title={
          <>
            Every <span className="serif-accent text-lilac">voice</span>
          </>
        }
      >
        <p className="font-mono text-sm text-bone/50">{items ? `${total} result${total === 1 ? "" : "s"}` : " "}</p>
      </PageHead>

      <div className="mb-4 flex items-center gap-3 rounded-full bg-ink-2 px-5 ring-1 ring-bone/10 focus-within:ring-2 focus-within:ring-lilac">
        <IconSearch className="shrink-0 text-bone/40" />
        <label htmlFor="q" className="sr-only">
          Search feedback
        </label>
        <input
          id="q"
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="Search what people wrote, e.g. wifi, cold dinner, route 12"
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
          options={[{ v: "", l: "All places" }, ...locations.map((l) => ({ v: String(l.id), l: l.name }))]}
        />
        <Seg label="Range" value={params.get("days") ?? ""} options={RANGES} onChange={(v) => set("days", v)} />
        {active > 0 && (
          <button
            onClick={() => {
              setText("");
              setParams({}, { replace: true });
            }}
            className="ml-auto text-sm text-lilac hover:text-bone"
          >
            Reset filters
          </button>
        )}
      </div>

      {error && <ErrorNote className="mb-4">{error}</ErrorNote>}

      {!items ? (
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
