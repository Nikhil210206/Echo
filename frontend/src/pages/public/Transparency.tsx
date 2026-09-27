import { useEffect, useMemo, useRef, useState } from "react";
import { PublicNav } from "@/components/layout/PublicNav";
import { DitherField } from "@/components/fx/DitherField";
import { Counter, SplitReveal } from "@/components/fx/motion";
import { ButtonLink, ErrorNote, StatusPill } from "@/components/ui/kit";
import { api } from "@/lib/api";
import { categoryLabel, daysBetween, STATUS_LABEL, timeAgo } from "@/lib/format";
import { gsap, useGSAP, prefersReducedMotion } from "@/lib/gsap";
import type { IssueStatus, PublicIssue, PublicStats } from "@/lib/types";
import { cn } from "@/lib/cn";

const OPEN_STATES: IssueStatus[] = ["reopened", "open", "acknowledged", "in_progress"];

export default function Transparency() {
  const [stats, setStats] = useState<PublicStats | null>(null);
  const [issues, setIssues] = useState<PublicIssue[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<IssueStatus | "all">("all");
  const ref = useRef<HTMLElement>(null);

  useEffect(() => {
    let alive = true;
    Promise.all([api.publicStats(), api.publicIssues()])
      .then(([s, i]) => {
        if (!alive) return;
        setStats(s);
        setIssues(i);
      })
      .catch((e: Error) => alive && setError(e.message));
    return () => {
      alive = false;
    };
  }, []);

  const resolved = useMemo(
    () =>
      (issues ?? [])
        .filter((i) => i.status === "resolved")
        .sort((a, b) => new Date(b.resolved_at!).getTime() - new Date(a.resolved_at!).getTime()),
    [issues],
  );
  const open = useMemo(
    () =>
      (issues ?? [])
        .filter((i) => OPEN_STATES.includes(i.status) && (filter === "all" || i.status === filter))
        .sort((a, b) => OPEN_STATES.indexOf(a.status) - OPEN_STATES.indexOf(b.status) || b.report_count - a.report_count),
    [issues, filter],
  );

  useGSAP(
    () => {
      if (!issues || prefersReducedMotion()) return;
      gsap.from(".res-card", { y: 50, opacity: 0, stagger: 0.1, duration: 1, scrollTrigger: { trigger: ".res-list", start: "top 85%" } });
      gsap.from(".verify-fill", { scaleX: 0, duration: 1.4, stagger: 0.1, scrollTrigger: { trigger: ".res-list", start: "top 80%" } });
    },
    { scope: ref, dependencies: [!!issues] },
  );

  return (
    <>
      <PublicNav tone="light" />
      <main ref={ref} className="min-h-[100svh] bg-bone pb-24 pt-28 text-ink">
        <div className="mx-auto max-w-[88rem] px-5 sm:px-8">
          <p className="eyebrow mb-5 text-ink/50">Public ledger · no login</p>
          <SplitReveal as="h1" className="display max-w-6xl text-[clamp(3.2rem,9vw,9rem)]">
            Everything reported.
            <br />
            <span className="serif-accent text-cobalt">Everything answered.</span>
          </SplitReveal>
          <p className="mt-8 max-w-xl text-lg text-ink/60">
            This page is public on purpose. You don't have to take our word that things get fixed: the people who reported each issue
            confirm it here.
          </p>

          {error && <ErrorNote className="mt-10">{error}</ErrorNote>}

          {/* Impact card */}
          <section className="relative mt-14 overflow-hidden rounded-[2.25rem] bg-cobalt text-bone">
            <DitherField cell={6} palette={["#2a1dd9", "#5446ff", "#9b91ff"]} sources={[{ x: 1, y: 1, strength: 1.2 }]} glow={110} />
            <div className="relative z-10 grid grid-cols-2 gap-x-6 gap-y-10 p-7 sm:p-10 lg:grid-cols-4 lg:p-12">
              {stats ? (
                [
                  { v: stats.people_heard, d: 0, s: "", l: "people heard" },
                  { v: stats.response_rate * 100, d: 0, s: "%", l: "response rate" },
                  { v: stats.avg_days_to_resolve, d: 1, s: "", l: "avg. days to resolve" },
                  { v: stats.verified_fix_rate * 100, d: 0, s: "%", l: "verified fixed by reporters" },
                ].map((f) => (
                  <div key={f.l}>
                    <p className="display text-[clamp(3rem,6.5vw,6.2rem)] leading-none">
                      <Counter value={f.v} decimals={f.d} suffix={f.s} duration={1.8} />
                    </p>
                    <p className="mt-3 text-bone/70">{f.l}</p>
                  </div>
                ))
              ) : (
                <div className="col-span-full h-32 animate-pulse rounded-2xl bg-bone/10" />
              )}
            </div>
          </section>

          {/* Recently resolved */}
          <section className="mt-24">
            <div className="mb-8 flex items-end justify-between gap-4">
              <h2 className="display text-[clamp(2.4rem,5vw,4.5rem)]">Recently fixed</h2>
              <p className="eyebrow hidden text-ink/45 sm:block">{resolved.length} resolved</p>
            </div>
            <div className="res-list grid gap-4 md:grid-cols-2">
              {!issues && !error && [0, 1].map((i) => <div key={i} className="h-72 animate-pulse rounded-[2rem] bg-ink/5" />)}
              {issues && resolved.length === 0 && <p className="text-ink/55">Nothing resolved yet. Check back soon.</p>}
              {resolved.map((i) => {
                const total = i.verification.fixed + i.verification.not_fixed;
                const share = total ? i.verification.fixed / total : 0;
                return (
                  <article key={i.id} className="res-card flex flex-col rounded-[2rem] bg-white p-7 sm:p-8">
                    <div className="mb-5 flex flex-wrap items-center justify-between gap-2">
                      <StatusPill status="resolved" light />
                      <span className="eyebrow text-ink/45">
                        fixed in {Math.max(1, Math.round(daysBetween(i.created_at, i.resolved_at!)))} days
                      </span>
                    </div>
                    <h3 className="display-soft text-[1.9rem] leading-tight">{i.title}</h3>
                    <p className="mt-1 text-ink/50">
                      {categoryLabel(i.category)} · {i.location_name} · {i.report_count} reports
                    </p>
                    {i.public_response && <p className="serif-accent mt-6 text-[1.4rem] leading-snug text-ink/85">“{i.public_response}”</p>}
                    <div className="mt-auto pt-8">
                      <div className="mb-2 flex justify-between text-sm">
                        <span className="text-ink/60">Reporters who confirmed the fix</span>
                        <span className="font-mono">
                          {total ? `${i.verification.fixed}/${total}` : "awaiting votes"}
                        </span>
                      </div>
                      <div className="h-2.5 overflow-hidden rounded-full bg-ink/10">
                        <div className="verify-fill h-full origin-left rounded-full bg-mint-deep" style={{ width: `${share * 100}%` }} />
                      </div>
                    </div>
                  </article>
                );
              })}
            </div>
          </section>

          {/* Still open */}
          <section className="mt-24">
            <div className="mb-8 flex flex-wrap items-end justify-between gap-4">
              <h2 className="display text-[clamp(2.4rem,5vw,4.5rem)]">Being worked on</h2>
              <div className="flex flex-wrap gap-2" role="group" aria-label="Filter by status">
                {(["all", ...OPEN_STATES] as const).map((s) => (
                  <button
                    key={s}
                    onClick={() => setFilter(s)}
                    aria-pressed={filter === s}
                    className={cn(
                      "rounded-full px-4 py-2 text-sm transition-colors",
                      filter === s ? "bg-ink text-bone" : "bg-white text-ink/65 hover:text-ink",
                    )}
                  >
                    {s === "all" ? "All" : STATUS_LABEL[s]}
                  </button>
                ))}
              </div>
            </div>
            <ul className="divide-y divide-ink/10 overflow-hidden rounded-[2rem] bg-white">
              {open.map((i) => (
                <li key={i.id} className="grid gap-3 px-6 py-5 sm:grid-cols-[1fr_auto_auto] sm:items-center sm:gap-8 sm:px-8">
                  <div>
                    <p className="text-lg font-medium">{i.title}</p>
                    <p className="text-sm text-ink/50">
                      {categoryLabel(i.category)} · {i.location_name} · opened {timeAgo(i.created_at)}
                    </p>
                  </div>
                  <span className="font-mono text-sm text-ink/60">{i.report_count} reports</span>
                  <StatusPill status={i.status} light />
                </li>
              ))}
              {issues && open.length === 0 && <li className="px-8 py-6 text-ink/55">Nothing in this state right now.</li>}
            </ul>
            <p className="mt-6 text-sm text-ink/45">
              Only issue titles, counts and public answers appear here. Individual feedback is never published.
            </p>
          </section>

          <div className="mt-20 flex flex-wrap gap-3">
            <ButtonLink to="/report" variant="ink" size="lg">
              Report an issue
            </ButtonLink>
            <ButtonLink to="/track" variant="ghost-dark" size="lg">
              Track a report
            </ButtonLink>
          </div>
        </div>
      </main>
    </>
  );
}
