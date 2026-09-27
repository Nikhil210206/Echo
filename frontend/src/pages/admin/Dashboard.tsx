import { useCallback, useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { Empty, PageHead, Panel, Skeleton, useConsole } from "@/components/admin/AdminShell";
import { Heatmap, Pipeline, SentimentOverTime, TopicSentiment } from "@/components/admin/charts";
import { EvidenceText } from "@/components/admin/EvidenceText";
import { IconArrowUpRight } from "@/components/admin/icons";
import { DitherField, pulseFrom } from "@/components/fx/DitherField";
import { Counter } from "@/components/fx/motion";
import { ErrorNote, SentimentChip, StatusPill, UrgencyTag } from "@/components/ui/kit";
import { api } from "@/lib/api";
import { cn } from "@/lib/cn";
import { categoryLabel, timeAgo } from "@/lib/format";
import { gsap, useGSAP, prefersReducedMotion } from "@/lib/gsap";
import { useLive } from "@/lib/live";
import type { AnalyticsSummary, IssueSummary, LiveEvent, PublicStats, SpikeAlert, Trend } from "@/lib/types";

interface Data {
  analytics: AnalyticsSummary;
  issues: IssueSummary[];
  alerts: { spikes: SpikeAlert[]; trends: Trend[] };
  stats: PublicStats;
}

export default function Dashboard() {
  const { pending } = useConsole();
  const [data, setData] = useState<Data | null>(null);
  const [error, setError] = useState<string | null>(null);
  const ref = useRef<HTMLDivElement>(null);

  const load = useCallback(() => {
    let alive = true;
    api
      .dashboardSummary()
      .then((res) => {
        if (!alive) return;
        setData(res);
        setError(null);
      })
      .catch((e: Error) => alive && setError(e.message));
    return () => {
      alive = false;
    };
  }, []);
  useEffect(load, [load]);

  // New reports shift priorities and counts: refresh shortly after they arrive
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  useLive(() => {
    clearTimeout(timer.current);
    timer.current = setTimeout(load, 700);
  });

  useGSAP(
    () => {
      if (!data || prefersReducedMotion()) return;
      gsap.fromTo(".dash-card", { y: 28, opacity: 0 }, { y: 0, opacity: 1, stagger: 0.06, duration: 0.9 });
    },
    { scope: ref, dependencies: [!!data] },
  );

  const hour = new Date().getHours();
  const greet = hour < 12 ? "Good morning" : hour < 17 ? "Good afternoon" : "Good evening";

  return (
    <div ref={ref}>
      <PageHead
        eyebrow={`${greet} · ${new Date().toLocaleDateString("en-IN", { weekday: "long", day: "numeric", month: "long" })}`}
        title={
          <>
            Campus <span className="serif-accent text-lilac">pulse</span>
          </>
        }
      >
        {pending > 0 && (
          <Link to="/admin/moderation" className="flex items-center gap-2 rounded-full bg-signal/15 px-4 py-2 text-sm text-signal ring-1 ring-signal/30 hover:bg-signal/25">
            {pending} waiting in moderation <IconArrowUpRight width={16} height={16} />
          </Link>
        )}
      </PageHead>

      {error && <ErrorNote className="mb-6">{error}</ErrorNote>}

      {!data ? (
        <div className="grid gap-4 lg:grid-cols-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className={cn("h-64", i === 3 && "lg:col-span-2")} />
          ))}
        </div>
      ) : (
        <div className="grid gap-4">
          <div className="grid gap-4 lg:grid-cols-[1.05fr_1.3fr_0.9fr] [&>*]:min-w-0">
            <SpikeCard spikes={data.alerts.spikes} issues={data.issues} />
            <ImpactCard stats={data.stats} />
            <TrendsCard trends={data.alerts.trends} />
          </div>

          <div className="grid gap-4 xl:grid-cols-[1.45fr_1fr] [&>*]:min-w-0">
            <PriorityQueue issues={data.issues} />
            <LiveFeed />
          </div>

          <div className="grid gap-4 xl:grid-cols-[1.45fr_1fr] [&>*]:min-w-0">
            <Panel className="dash-card" title="Sentiment over time">
              <SentimentOverTime data={data.analytics.sentiment_over_time} />
            </Panel>
            <Panel className="dash-card" title="Topic × sentiment">
              <TopicSentiment data={data.analytics.topic_sentiment} />
            </Panel>
          </div>

          <div className="grid gap-4 xl:grid-cols-[1.45fr_1fr] [&>*]:min-w-0">
            <Panel className="dash-card" title="Where it hurts">
              <Heatmap data={data.analytics.heatmap} />
            </Panel>
            <Panel className="dash-card" title="Issue pipeline">
              <Pipeline data={data.analytics.pipeline} avgDays={data.analytics.avg_days_to_resolve} />
            </Panel>
          </div>
        </div>
      )}
    </div>
  );
}

/* ---- Spike alert -------------------------------------------------------- */

function SpikeCard({ spikes, issues }: { spikes: SpikeAlert[]; issues: IssueSummary[] }) {
  const s = spikes[0];
  if (!s)
    return (
      <section className="dash-card flex flex-col justify-between rounded-[1.75rem] bg-mint p-6 text-ink">
        <p className="eyebrow">Spike alerts</p>
        <p className="display mt-10 text-4xl">All quiet.</p>
        <p className="mt-2 text-ink/70">No place and topic is running at twice its usual rate in the last 72 hours.</p>
      </section>
    );
  const match = issues.find((i) => i.category === s.category && i.location_name === s.location_name);
  return (
    <section className="dash-card relative flex flex-col overflow-hidden rounded-[1.75rem] bg-signal p-6 text-ink">
      <div className="flex items-center justify-between">
        <p className="eyebrow flex items-center gap-2">
          <span className="relative flex h-2 w-2">
            <span className="absolute h-full w-full animate-ping rounded-full bg-ink opacity-50" />
            <span className="relative h-2 w-2 rounded-full bg-ink" />
          </span>
          Spike alert
        </p>
        {spikes.length > 1 && <span className="font-mono text-xs">+{spikes.length - 1} more</span>}
      </div>
      <p className="mt-6 text-lg font-medium">
        {categoryLabel(s.category)} · {s.location_name}
      </p>
      <p className="display text-[5.5rem] leading-[0.85]">
        <Counter value={s.ratio} decimals={1} suffix="×" duration={1.4} />
      </p>
      <p className="mt-2 text-sm text-ink/75">the usual rate of complaints</p>
      <div className="mt-5 rounded-2xl bg-ink/10 p-3 font-mono text-xs leading-relaxed">
        {s.current} negative in the last 72 h
        <br />÷ usual {s.baseline} per 72 h (28-day average)
      </div>
      {match && (
        <Link to={`/admin/issues/${match.id}`} className="mt-4 inline-flex w-fit items-center gap-1.5 rounded-full bg-ink px-4 py-2.5 text-sm text-bone hover:bg-ink-3">
          Open issue #{match.id} <IconArrowUpRight width={16} height={16} />
        </Link>
      )}
    </section>
  );
}

/* ---- Impact ------------------------------------------------------------- */

function ImpactCard({ stats }: { stats: PublicStats }) {
  const items = [
    { v: stats.people_heard, d: 0, s: "", l: "people heard" },
    { v: stats.response_rate * 100, d: 0, s: "%", l: "response rate" },
    { v: stats.avg_days_to_resolve, d: 1, s: "", l: "days to resolve" },
    { v: stats.verified_fix_rate * 100, d: 0, s: "%", l: "verified fixed" },
  ];
  return (
    <section className="dash-card relative overflow-hidden rounded-[1.75rem] bg-cobalt p-6">
      <DitherField cell={6} palette={["#2a1dd9", "#5446ff", "#9b91ff"]} sources={[{ x: 1, y: 0, strength: 1.1 }]} glow={100} />
      <div className="relative z-10 flex h-full flex-col">
        <div className="flex items-center justify-between">
          <p className="eyebrow text-lilac">Impact</p>
          <Link to="/transparency" className="text-xs text-bone/70 underline-offset-4 hover:underline">
            Public page ↗
          </Link>
        </div>
        <div className="mt-auto grid grid-cols-2 gap-x-4 gap-y-6 pt-10">
          {items.map((i) => (
            <div key={i.l}>
              <p className="display text-[3.2rem] leading-none">
                <Counter value={i.v} decimals={i.d} suffix={i.s} duration={1.6} />
              </p>
              <p className="mt-1 text-sm text-bone/70">{i.l}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

/* ---- Trends ------------------------------------------------------------- */

function TrendsCard({ trends }: { trends: Trend[] }) {
  return (
    <Panel className="dash-card" title="This week vs last week">
      {trends.length === 0 ? (
        <p className="text-sm text-bone/55">No change in complaints from last week.</p>
      ) : (
        <ul className="space-y-2.5">
          {trends.slice(0, 4).map((t) => {
            const up = t.this_week > t.last_week;
            // A percentage on a tiny base ("up 1200%") misleads; show it only when last week had a few
            const change = t.last_week >= 3 ? `${Math.abs(t.change_pct)}%` : up ? "new" : "";
            return (
              <li key={t.category} className="flex items-center justify-between gap-3 rounded-2xl bg-bone/[0.03] px-4 py-3">
                <span className="min-w-0">
                  <span className="block truncate">{categoryLabel(t.category)} complaints</span>
                  <span className="block font-mono text-xs text-bone/40">
                    {t.this_week} this week · {t.last_week} last
                  </span>
                </span>
                <span className={cn("flex shrink-0 items-center gap-1 font-mono text-sm", up ? "text-signal" : "text-mint")}>
                  <span aria-hidden>{up ? "↑" : "↓"}</span>
                  <span className="sr-only">{up ? "up" : "down"}</span>
                  {change}
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </Panel>
  );
}

/* ---- Priority queue ----------------------------------------------------- */

function PriorityQueue({ issues }: { issues: IssueSummary[] }) {
  const top = issues.slice(0, 5);
  const max = Math.max(...top.map((i) => i.priority_score ?? 0), 1);
  return (
    <Panel
      className="dash-card"
      title="Priority queue"
      action={
        <Link to="/admin/issues" className="text-sm text-bone/55 hover:text-bone">
          All issues →
        </Link>
      }
    >
      {top.length === 0 ? (
        <Empty title="Nothing open">Every issue is resolved. Enjoy it while it lasts.</Empty>
      ) : (
        <ol className="space-y-2">
          {top.map((i, idx) => (
            <li key={i.id}>
              <Link
                to={`/admin/issues/${i.id}`}
                className="group grid grid-cols-[2.2rem_1fr_auto] items-center gap-4 rounded-2xl px-3 py-3.5 transition-colors hover:bg-bone/[0.04]"
              >
                <span className={cn("display text-3xl", idx === 0 ? "text-signal" : "text-bone/30")}>{idx + 1}</span>
                <span className="min-w-0">
                  <span className="flex flex-wrap items-center gap-2">
                    <span className="truncate font-medium">{i.title}</span>
                    <UrgencyTag urgency={i.urgency ?? "normal"} />
                  </span>
                  <span className="mt-1 block text-xs text-bone/45">
                    {categoryLabel(i.category)} · {i.location_name} · {i.report_count} reports · {i.assignee?.name ?? "unassigned"}
                  </span>
                  <span className="mt-2 block h-1.5 rounded-full bg-bone/[0.06]">
                    <span className="block h-1.5 rounded-full bg-lilac" style={{ width: `${((i.priority_score ?? 0) / max) * 100}%` }} />
                  </span>
                </span>
                <span className="flex flex-col items-end gap-2">
                  <span className="font-mono text-lg">{(i.priority_score ?? 0).toFixed(1)}</span>
                  <StatusPill status={i.status} />
                </span>
              </Link>
            </li>
          ))}
        </ol>
      )}
    </Panel>
  );
}

/* ---- Live feed ---------------------------------------------------------- */

interface FeedItem {
  key: string;
  e: LiveEvent;
}

function LiveFeed() {
  const [items, setItems] = useState<FeedItem[] | null>(null);
  const list = useRef<HTMLUListElement>(null);
  const fresh = useRef<string | null>(null);

  useEffect(() => {
    let alive = true;
    api
      .recentFeed()
      .then((rows) => alive && setItems(rows.map((f) => ({ key: `f${f.id}`, e: { type: f.kind === "me_too" ? "me_too" : "feedback", at: f.created_at, feedback: f } }))))
      .catch(() => alive && setItems([]));
    return () => {
      alive = false;
    };
  }, []);

  useLive((e) => {
    if (e.type === "moderation") return; // flagged items wait in the queue, not the feed
    const key = `${e.type}-${e.at}-${Math.random()}`;
    fresh.current = key;
    setItems((prev) => [{ key, e }, ...(prev ?? [])].slice(0, 30));
  });

  // Slide each new arrival in and ripple the page from it
  useEffect(() => {
    const key = fresh.current;
    if (!key || !list.current) return;
    const el = list.current.querySelector<HTMLElement>(`[data-key="${CSS.escape(key)}"]`);
    fresh.current = null;
    if (!el || prefersReducedMotion()) return;
    gsap.fromTo(el, { height: 0, opacity: 0 }, { height: "auto", opacity: 1, duration: 0.7 });
    gsap.fromTo(el, { backgroundColor: "rgba(201,194,255,.16)" }, { backgroundColor: "rgba(201,194,255,0)", duration: 2.4, ease: "power1.out" });
    pulseFrom(el, 1.2);
  }, [items]);

  return (
    <Panel
      className="dash-card flex max-h-[34rem] flex-col"
      title={
        <span className="flex items-center gap-2">
          Live feed
          <span className="h-2 w-2 animate-pulse rounded-full bg-mint" />
        </span>
      }
    >
      {!items ? (
        <Skeleton className="h-72" />
      ) : items.length === 0 ? (
        <Empty title="Waiting for voices">New feedback will appear here the moment it's sent.</Empty>
      ) : (
        <ul ref={list} className="-mx-2 flex-1 space-y-1 overflow-y-auto pr-1 no-scrollbar">
          {items.map(({ key, e }) => (
            <li key={key} data-key={key} className="overflow-hidden rounded-2xl px-3 py-3">
              <FeedRow e={e} />
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}

function FeedRow({ e }: { e: LiveEvent }) {
  if (e.type === "issue_status" && e.issue)
    return (
      <div className="flex items-center justify-between gap-3 text-sm">
        <span className="min-w-0 truncate text-bone/70">
          <span className="text-bone">{e.issue.title}</span> moved
        </span>
        <StatusPill status={e.issue.status} />
      </div>
    );
  const f = e.feedback;
  if (!f) return null;
  if (f.kind === "me_too")
    return (
      <div className="text-sm">
        <p className="text-bone/70">
          <span className="font-medium text-lilac">Me too</span> on <span className="text-bone">{e.issue?.title ?? categoryLabel(f.aspects[0]?.category)}</span>
          {e.issue && <span className="font-mono text-bone/50"> · {e.issue.report_count} reports</span>}
        </p>
        <p className="mt-1 text-xs text-bone/40">
          {f.location_name} · {timeAgo(f.created_at)}
        </p>
      </div>
    );
  return (
    <div>
      <EvidenceText
        className="text-sm"
        text={f.text_redacted ?? ""}
        spans={f.aspects.map((a) => ({ text: a.evidence_span, sentiment: a.sentiment, label: categoryLabel(a.category) }))}
      />
      <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-bone/45">
        {f.aspects.map((a) => (
          <span key={a.id} className="flex items-center gap-1.5">
            {categoryLabel(a.category)} <SentimentChip sentiment={a.sentiment} className="!text-[0.7rem] text-bone/55" />
          </span>
        ))}
        <span className="ml-auto">
          {f.location_name} · {timeAgo(f.created_at)}
        </span>
      </div>
    </div>
  );
}
