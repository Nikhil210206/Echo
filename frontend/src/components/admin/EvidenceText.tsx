import { Fragment } from "react";
import type { Sentiment } from "@/lib/types";
import { cn } from "@/lib/cn";

const MARK: Record<Sentiment, string> = {
  positive: "bg-[#5fd98a]/22 text-bone decoration-[#5fd98a]",
  neutral: "bg-bone/10 text-bone decoration-bone/40",
  negative: "bg-signal/25 text-bone decoration-signal",
};

interface Span {
  text: string;
  sentiment: Sentiment;
  label?: string;
}

/**
 * Renders feedback with the evidence behind each aspect label highlighted, so
 * an admin can see exactly which words produced which label. Search terms get
 * an underline on top.
 */
export function EvidenceText({ text, spans, terms = [], className }: { text: string; spans: Span[]; terms?: string[]; className?: string }) {
  type Piece = { s: number; e: number; span?: Span };
  const lower = text.toLowerCase();
  const found: Piece[] = [];
  for (const sp of spans) {
    if (!sp.text) continue;
    const i = lower.indexOf(sp.text.toLowerCase());
    if (i === -1 || found.some((f) => i < f.e && i + sp.text.length > f.s)) continue;
    found.push({ s: i, e: i + sp.text.length, span: sp });
  }
  found.sort((a, b) => a.s - b.s);
  const pieces: Piece[] = [];
  let at = 0;
  for (const f of found) {
    if (f.s > at) pieces.push({ s: at, e: f.s });
    pieces.push(f);
    at = f.e;
  }
  if (at < text.length) pieces.push({ s: at, e: text.length });

  const withTerms = (chunk: string, key: string) => {
    const ts = terms.filter(Boolean);
    if (!ts.length) return chunk;
    const re = new RegExp(`(${ts.map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|")})`, "gi");
    return chunk.split(re).map((part, i) =>
      i % 2 ? (
        <span key={`${key}-${i}`} className="underline decoration-lilac decoration-2 underline-offset-4">
          {part}
        </span>
      ) : (
        <Fragment key={`${key}-${i}`}>{part}</Fragment>
      ),
    );
  };

  return (
    <p className={cn("leading-relaxed text-bone/75", className)}>
      {pieces.map((p, i) =>
        p.span ? (
          <mark
            key={i}
            title={p.span.label ? `${p.span.label}: ${p.span.sentiment}` : p.span.sentiment}
            className={cn("rounded-md px-1 py-0.5 [box-decoration-break:clone]", MARK[p.span.sentiment])}
          >
            {withTerms(text.slice(p.s, p.e), `m${i}`)}
          </mark>
        ) : (
          <Fragment key={i}>{withTerms(text.slice(p.s, p.e), `t${i}`)}</Fragment>
        ),
      )}
    </p>
  );
}
