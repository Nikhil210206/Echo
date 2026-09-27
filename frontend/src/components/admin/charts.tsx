import { useState } from "react";
import { Area, AreaChart, Bar, BarChart, CartesianGrid, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import type { AnalyticsSummary, IssueStatus } from "@/lib/types";
import { categoryLabel, STATUS_LABEL } from "@/lib/format";
import { cn } from "@/lib/cn";

/*
  Chart colours. Sentiment is a diverging job: two poles and a grey midpoint.
  Poles checked with the dataviz validator on the ink-2 surface:
  deutan ΔE 12.5, normal-vision ΔE 33 — distinguishable for colour-blind readers.
*/
export const SENT = { positive: "#5fd98a", neutral: "#6f6f7c", negative: "#ff5a1f" } as const;
const AXIS = "rgba(243,240,232,.45)";
const GRID = "rgba(243,240,232,.07)";

function Legend({ items }: { items: { label: string; color: string }[] }) {
  return (
    <ul className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-bone/60">
      {items.map((i) => (
        <li key={i.label} className="flex items-center gap-1.5">
          <span className="h-2.5 w-2.5 rounded-[3px]" style={{ background: i.color }} />
          {i.label}
        </li>
      ))}
    </ul>
  );
}

function TipBox({ title, rows }: { title: string; rows: { label: string; value: string | number; color?: string }[] }) {
  return (
    <div className="min-w-40 rounded-xl bg-ink px-3 py-2.5 text-xs shadow-2xl ring-1 ring-bone/15">
      <p className="mb-1.5 font-medium text-bone">{title}</p>
      {rows.map((r) => (
        <p key={r.label} className="flex items-center justify-between gap-4 text-bone/70">
          <span className="flex items-center gap-1.5">
            {r.color && <span className="h-2 w-2 rounded-[2px]" style={{ background: r.color }} />}
            {r.label}
          </span>
          <span className="font-mono text-bone">{r.value}</span>
        </p>
      ))}
    </div>
  );
}

const shortDate = (d: string) => new Date(d).toLocaleDateString("en-IN", { day: "numeric", month: "short" });

/* ---- 1. Sentiment over time -------------------------------------------- */

export function SentimentOverTime({ data }: { data: AnalyticsSummary["sentiment_over_time"] }) {
  return (
    <div>
      <Legend
        items={[
          { label: "Negative", color: SENT.negative },
          { label: "Neutral", color: SENT.neutral },
          { label: "Positive", color: SENT.positive },
        ]}
      />
      <div className="mt-4 h-64">
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={data} margin={{ top: 4, right: 4, bottom: 0, left: -18 }}>
            <defs>
              {(["negative", "neutral", "positive"] as const).map((k) => (
                <linearGradient key={k} id={`g-${k}`} x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={SENT[k]} stopOpacity={0.55} />
                  <stop offset="100%" stopColor={SENT[k]} stopOpacity={0.12} />
                </linearGradient>
              ))}
            </defs>
            <CartesianGrid stroke={GRID} vertical={false} />
            <XAxis dataKey="date" tickFormatter={shortDate} tick={{ fill: AXIS, fontSize: 11 }} axisLine={false} tickLine={false} minTickGap={28} />
            <YAxis tick={{ fill: AXIS, fontSize: 11 }} axisLine={false} tickLine={false} allowDecimals={false} />
            <Tooltip
              cursor={{ stroke: "rgba(243,240,232,.25)", strokeWidth: 1 }}
              content={({ active, payload, label }) =>
                active && payload?.length ? (
                  <TipBox
                    title={shortDate(String(label))}
                    rows={[...payload].reverse().map((p) => ({ label: String(p.name), value: Number(p.value), color: SENT[p.dataKey as keyof typeof SENT] }))}
                  />
                ) : null
              }
            />
            {(["positive", "neutral", "negative"] as const).map((k) => (
              <Area
                key={k}
                type="monotone"
                dataKey={k}
                name={k[0].toUpperCase() + k.slice(1)}
                stackId="s"
                stroke={SENT[k]}
                strokeWidth={2}
                fill={`url(#g-${k})`}
                activeDot={{ r: 4, stroke: "#16161c", strokeWidth: 2 }}
              />
            ))}
          </AreaChart>
        </ResponsiveContainer>
      </div>
      <p className="mt-2 text-xs text-bone/40">Aspect mentions per day, last 6 weeks</p>
    </div>
  );
}

/* ---- 2. Topic × sentiment (diverging) ---------------------------------- */

export function TopicSentiment({ data }: { data: AnalyticsSummary["topic_sentiment"] }) {
  const rows = data.map((d) => ({ topic: categoryLabel(d.topic), negative: -d.negative, positive: d.positive }));
  const raw = Math.max(...data.map((d) => Math.max(d.negative, d.positive)), 1);
  const step = raw > 40 ? 20 : raw > 20 ? 10 : 5;
  const max = Math.ceil(raw / step) * step;
  const ticks = [-max, -max / 2, 0, max / 2, max];
  return (
    <div>
      <Legend
        items={[
          { label: "Negative mentions", color: SENT.negative },
          { label: "Positive mentions", color: SENT.positive },
        ]}
      />
      <div className="mt-4 h-64">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={rows} layout="vertical" stackOffset="sign" margin={{ top: 0, right: 8, bottom: 0, left: 6 }} barCategoryGap={6}>
            <CartesianGrid stroke={GRID} horizontal={false} />
            <XAxis type="number" domain={[-max, max]} ticks={ticks} tickFormatter={(v) => String(Math.abs(v))} tick={{ fill: AXIS, fontSize: 11 }} axisLine={false} tickLine={false} />
            <YAxis type="category" dataKey="topic" width={84} tick={{ fill: "rgba(243,240,232,.75)", fontSize: 12 }} axisLine={false} tickLine={false} />
            <ReferenceLine x={0} stroke="rgba(243,240,232,.3)" />
            <Tooltip
              cursor={{ fill: "rgba(243,240,232,.04)" }}
              content={({ active, payload, label }) =>
                active && payload?.length ? (
                  <TipBox
                    title={String(label)}
                    rows={[
                      { label: "Negative", value: Math.abs(Number(payload.find((p) => p.dataKey === "negative")?.value ?? 0)), color: SENT.negative },
                      { label: "Positive", value: Number(payload.find((p) => p.dataKey === "positive")?.value ?? 0), color: SENT.positive },
                    ]}
                  />
                ) : null
              }
            />
            <Bar dataKey="negative" stackId="t" fill={SENT.negative} radius={[4, 0, 0, 4]} />
            <Bar dataKey="positive" stackId="t" fill={SENT.positive} radius={[0, 4, 4, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </div>
      <p className="mt-2 text-xs text-bone/40">Where people are unhappy (left) and happy (right)</p>
    </div>
  );
}

/* ---- 3. Location × category heatmap ------------------------------------ */

// One hue, dark → light: more complaints glow brighter on the dark surface
const RAMP = ["#1c1740", "#2a1f8f", "#3b2bff", "#7b6fff", "#c9c2ff"];
function rampColor(t: number) {
  if (t <= 0) return "rgba(243,240,232,.03)";
  const x = Math.min(0.999, t) * (RAMP.length - 1);
  const i = Math.floor(x);
  const mix = (a: string, b: string, f: number) => {
    const pa = parseInt(a.slice(1), 16);
    const pb = parseInt(b.slice(1), 16);
    const c = [16, 8, 0].map((s) => Math.round(((pa >> s) & 255) * (1 - f) + ((pb >> s) & 255) * f));
    return `rgb(${c.join(",")})`;
  };
  return mix(RAMP[i], RAMP[i + 1], x - i);
}

export function Heatmap({ data }: { data: AnalyticsSummary["heatmap"] }) {
  const max = Math.max(...data.values.flat(), 1);
  const [hover, setHover] = useState<{ l: number; c: number } | null>(null);
  return (
    <div>
      <div className="overflow-x-auto no-scrollbar">
        <table className="w-full min-w-[34rem] border-separate border-spacing-1 text-xs">
          <thead>
            <tr>
              <th className="w-32" />
              {data.categories.map((c, ci) => (
                <th key={c} scope="col" className={cn("pb-1 text-left font-normal text-bone/50", hover?.c === ci && "text-bone")}>
                  {categoryLabel(c)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {data.locations.map((l, li) => (
              <tr key={l}>
                <th scope="row" className={cn("pr-2 text-left font-normal text-bone/60", hover?.l === li && "text-bone")}>
                  {l}
                </th>
                {data.values[li].map((v, ci) => {
                  const t = v / max;
                  return (
                    <td
                      key={ci}
                      onPointerEnter={() => setHover({ l: li, c: ci })}
                      onPointerLeave={() => setHover(null)}
                      className={cn(
                        "h-11 rounded-lg text-center font-mono tabular transition-[box-shadow]",
                        t > 0.55 ? "text-ink" : "text-bone/80",
                        hover?.l === li && hover?.c === ci && "ring-2 ring-bone",
                      )}
                      style={{ background: rampColor(t) }}
                      aria-label={`${l}, ${categoryLabel(data.categories[ci])}: ${v} negative mentions`}
                    >
                      {v || ""}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="mt-3 flex items-center justify-between gap-4 text-xs text-bone/45">
        <span>
          {hover ? (
            <>
              <span className="text-bone">{data.locations[hover.l]}</span> · {categoryLabel(data.categories[hover.c])} ·{" "}
              <span className="font-mono text-bone">{data.values[hover.l][hover.c]}</span> negative mentions
            </>
          ) : (
            "Negative mentions by place and topic. Hover a cell."
          )}
        </span>
        <span className="flex items-center gap-2">
          0
          <span className="h-2 w-24 rounded-full" style={{ background: `linear-gradient(90deg, ${RAMP.join(",")})` }} />
          {max}
        </span>
      </div>
    </div>
  );
}

/* ---- 4. Issue pipeline -------------------------------------------------- */

const PIPE_COLOR: Record<IssueStatus, string> = {
  open: "#ff5a1f",
  acknowledged: "#ffc53d",
  in_progress: "#c9c2ff",
  resolved: "#5fd98a",
  reopened: "#ff5a1f",
};

export function Pipeline({ data, avgDays }: { data: AnalyticsSummary["pipeline"]; avgDays: number }) {
  const max = Math.max(...data.map((d) => d.count), 1);
  return (
    <div className="grid gap-6 sm:grid-cols-[1fr_auto] sm:items-end">
      <ul className="space-y-3">
        {data.map((d) => (
          <li key={d.status} className="grid grid-cols-[6.5rem_1fr_2rem] items-center gap-3 text-sm">
            <span className="text-bone/70">{STATUS_LABEL[d.status]}</span>
            <span className="h-3 rounded-full bg-bone/[0.05]">
              <span
                className={cn("block h-3 rounded-full", d.status === "reopened" && "bg-[repeating-linear-gradient(45deg,#ff5a1f_0_4px,#ff8a5c_4px_8px)]")}
                style={{ width: `${Math.max(4, (d.count / max) * 100)}%`, background: d.status === "reopened" ? undefined : PIPE_COLOR[d.status] }}
                title={`${STATUS_LABEL[d.status]}: ${d.count}`}
              />
            </span>
            <span className="text-right font-mono text-bone">{d.count}</span>
          </li>
        ))}
      </ul>
      <div className="rounded-2xl bg-bone/[0.04] px-5 py-4 sm:text-right">
        <p className="display text-5xl leading-none">{avgDays}</p>
        <p className="mt-1 text-xs text-bone/50">days to resolve, on average</p>
      </div>
    </div>
  );
}
