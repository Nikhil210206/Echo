import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { Empty, PageHead, Skeleton } from "@/components/admin/AdminShell";
import { ErrorNote, StatusPill, UrgencyTag } from "@/components/ui/kit";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { cn } from "@/lib/cn";
import { CATEGORIES, categoryLabel, pct, STATUS_LABEL, timeAgo } from "@/lib/format";
import { gsap, useGSAP, prefersReducedMotion } from "@/lib/gsap";
import { useLive } from "@/lib/live";
import type { IssueStatus, IssueSummary } from "@/lib/types";

type Filter = "active" | IssueStatus | "all";
const FILTERS: Filter[] = ["active", "reopened", "open", "acknowledged", "in_progress", "resolved", "all"];

export default function Issues() {
  const { user } = useAuth();
  const isAdmin = user?.role === "admin";
  const [all, setAll] = useState<IssueSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<Filter>("active");
  const [category, setCategory] = useState("");
  const [reload, setReload] = useState(0);
  const list = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let alive = true;
    api
      .issues()
      .then((i) => alive && setAll(i))
      .catch((e: Error) => alive && setError(e.message));
    return () => {
      alive = false;
    };
  }, [reload]);

  useLive((e) => {
    if (e.type !== "moderation") setReload((r) => r + 1);
  });

  const shown = useMemo(() => {
    if (!all) return null;
    return all
      .filter((i) =>
        filter === "all" ? true : filter === "active" ? i.status !== "resolved" : i.status === filter,
      )
      .filter((i) => !category || i.category === category);
  }, [all, filter, category]);

  const counts = useMemo(() => {
    const c: Record<string, number> = { all: all?.length ?? 0, active: 0 };
    all?.forEach((i) => {
      c[i.status] = (c[i.status] ?? 0) + 1;
      if (i.status !== "resolved") c.active++;
    });
    return c;
  }, [all]);

  useGSAP(
    () => {
      if (!shown || prefersReducedMotion()) return;
      gsap.fromTo(".issue-row", { y: 16, opacity: 0 }, { y: 0, opacity: 1, stagger: 0.035, duration: 0.6 });
    },
    { scope: list, dependencies: [filter, category, !!all] },
  );

  const maxScore = Math.max(...(shown ?? []).map((i) => i.priority_score ?? 0), 1);

  return (
    <div>
      <PageHead
        eyebrow={isAdmin ? "Sorted by priority" : `Assigned to ${user?.name}`}
        title={isAdmin ? "Issues" : <>My <span className="serif-accent text-lilac">issues</span></>}
      />

      <div className="mb-5 flex flex-wrap items-center gap-2">
        <div className="flex flex-wrap gap-1.5 rounded-full bg-ink-2 p-1.5 ring-1 ring-bone/[0.06]" role="group" aria-label="Filter by status">
          {FILTERS.map((f) => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              aria-pressed={filter === f}
              className={cn(
                "flex h-9 items-center gap-2 rounded-full px-4 text-sm transition-colors",
                filter === f ? "bg-bone text-ink" : "text-bone/60 hover:text-bone",
              )}
            >
              {f === "active" ? "Active" : f === "all" ? "All" : STATUS_LABEL[f]}
              <span className={cn("font-mono text-xs", filter === f ? "text-ink/50" : "text-bone/35")}>{counts[f] ?? 0}</span>
            </button>
          ))}
        </div>
        <label className="ml-auto flex items-center gap-2 text-sm text-bone/55">
          Topic
          <select
            value={category}
            onChange={(e) => setCategory(e.target.value)}
            className="h-11 rounded-full bg-ink-2 px-4 text-bone outline-none ring-1 ring-bone/10 focus:ring-lilac"
          >
            <option value="">All topics</option>
            {CATEGORIES.map((c) => (
              <option key={c} value={c}>
                {categoryLabel(c)}
              </option>
            ))}
          </select>
        </label>
      </div>

      {error && <ErrorNote className="mb-4">{error}</ErrorNote>}

      <div ref={list} className="overflow-hidden rounded-[1.75rem] bg-ink-2 ring-1 ring-bone/[0.06]">
        <div className="hidden grid-cols-[3rem_minmax(0,1fr)_7rem_6rem_9rem_8rem] gap-4 border-b border-bone/[0.06] px-6 py-3 text-xs text-bone/40 lg:grid">
          <span>Rank</span>
          <span>Issue</span>
          <span className="text-right">Reports</span>
          <span className="text-right">Negative</span>
          <span>Priority</span>
          <span>Status</span>
        </div>
        {!shown ? (
          <div className="space-y-2 p-4">
            {Array.from({ length: 6 }).map((_, i) => (
              <Skeleton key={i} className="h-16" />
            ))}
          </div>
        ) : shown.length === 0 ? (
          <div className="p-6">
            <Empty title={isAdmin ? "No issues here" : "Nothing assigned"}>
              {isAdmin ? "Try another status or topic." : "When an admin assigns you an issue it shows up here."}
            </Empty>
          </div>
        ) : (
          <ul className="divide-y divide-bone/[0.06]">
            {shown.map((i, idx) => (
              <li key={i.id} className="issue-row">
                <Link
                  to={`/admin/issues/${i.id}`}
                  className="grid grid-cols-[2.5rem_1fr_auto] items-center gap-4 px-5 py-4 transition-colors hover:bg-bone/[0.03] lg:grid-cols-[3rem_minmax(0,1fr)_7rem_6rem_9rem_8rem] lg:px-6"
                >
                  <span className={cn("display text-2xl", i.status === "resolved" ? "text-bone/20" : idx === 0 ? "text-signal" : "text-bone/35")}>
                    {i.status === "resolved" ? "✓" : idx + 1}
                  </span>
                  <span className="min-w-0">
                    <span className="flex flex-wrap items-center gap-2">
                      <span className="font-medium">{i.title}</span>
                      <UrgencyTag urgency={i.urgency ?? "normal"} />
                      {(i.reopened_count ?? 0) > 0 && i.status !== "reopened" && (
                        <span className="eyebrow rounded bg-signal/15 px-1.5 !text-[0.6rem] text-signal">reopened before</span>
                      )}
                    </span>
                    <span className="mt-1 block truncate text-xs text-bone/45">
                      {categoryLabel(i.category)} · {i.location_name} · {i.assignee?.name ?? "Unassigned"} · opened {timeAgo(i.created_at)}
                    </span>
                  </span>
                  <span className="text-right font-mono lg:order-none">
                    {i.report_count}
                    <span className="block text-[0.65rem] text-bone/35 lg:hidden">reports</span>
                  </span>
                  <span className="hidden text-right font-mono text-bone/70 lg:block">{pct(i.negative_share ?? 0)}</span>
                  <span className="hidden items-center gap-3 lg:flex">
                    <span className="h-1.5 flex-1 rounded-full bg-bone/[0.06]">
                      <span className="block h-1.5 rounded-full bg-lilac" style={{ width: `${((i.priority_score ?? 0) / maxScore) * 100}%` }} />
                    </span>
                    <span className="w-10 text-right font-mono text-sm">{(i.priority_score ?? 0).toFixed(1)}</span>
                  </span>
                  <span className="hidden lg:block">
                    <StatusPill status={i.status} />
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
