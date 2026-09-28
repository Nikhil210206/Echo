import { useEffect, useRef, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { Empty, Panel, Skeleton } from "@/components/admin/AdminShell";
import { Reporter } from "@/components/admin/Reporter";
import { EvidenceText } from "@/components/admin/EvidenceText";
import { pulseFrom } from "@/components/fx/DitherField";
import { Counter } from "@/components/fx/motion";
import { Button, ErrorNote, SentimentChip, Spinner, StatusPill, UrgencyTag } from "@/components/ui/kit";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { cn } from "@/lib/cn";
import { categoryLabel, STATUS_LABEL, STATUS_ORDER, timeAgo } from "@/lib/format";
import { gsap, useGSAP, prefersReducedMotion } from "@/lib/gsap";
import { useLive } from "@/lib/live";
import type { IssueDetail as Detail, IssueStatus, IssueUpdate, User } from "@/lib/types";

const NEXT: Partial<Record<IssueStatus, { to: IssueStatus; label: string }>> = {
  open: { to: "acknowledged", label: "Acknowledge" },
  acknowledged: { to: "in_progress", label: "Start work" },
  in_progress: { to: "resolved", label: "Resolve" },
  reopened: { to: "in_progress", label: "Start work again" },
};

export default function IssueDetail() {
  const id = useParams().id ?? "";
  const [issue, setIssue] = useState<Detail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let alive = true;
    setIssue(null);
    setError(null);
    if (!id) return;
    api
      .issue(id)
      .then((i) => alive && setIssue(i))
      .catch((e: Error) => alive && setError(e.message));
    return () => {
      alive = false;
    };
  }, [id]);

  // Reporters can reopen it or add "me too" while you're looking
  useLive((e) => {
    if (String(e.issue?.id) === String(id) || e.feedback?.aspects.some((a) => String(a.issue_id) === String(id))) {
      api.issue(id).then(setIssue).catch(() => {});
    }
  });

  useGSAP(
    () => {
      if (!issue || prefersReducedMotion()) return;
      gsap.fromTo(".det-block", { y: 24, opacity: 0 }, { y: 0, opacity: 1, stagger: 0.07, duration: 0.8 });
    },
    { scope: ref, dependencies: [issue?.id] },
  );

  if (error)
    return (
      <div className="max-w-xl">
        <Link to="/admin/issues" className="text-sm text-bone/50 hover:text-bone">
          ← Issues
        </Link>
        <ErrorNote className="mt-6">{error}</ErrorNote>
      </div>
    );
  if (!issue)
    return (
      <div className="space-y-4">
        <Skeleton className="h-8 w-40" />
        <Skeleton className="h-24 w-2/3" />
        <div className="grid gap-4 lg:grid-cols-[1.5fr_1fr]">
          <Skeleton className="h-96" />
          <Skeleton className="h-96" />
        </div>
      </div>
    );

  return (
    <div ref={ref}>
      <Link to="/admin/issues" className="text-sm text-bone/50 hover:text-bone">
        ← Issues
      </Link>
      <Header issue={issue} onSaved={setIssue} />
      <div className="mt-8 grid gap-4 xl:grid-cols-[1.5fr_1fr] [&>*]:min-w-0">
        <div className="space-y-4">
          <WhyRanked issue={issue} />
          <Evidence issue={issue} />
        </div>
        <div className="space-y-4 xl:sticky xl:top-6 xl:self-start">
          <Actions issue={issue} onSaved={setIssue} />
          <Timeline issue={issue} />
        </div>
      </div>
    </div>
  );
}

/* ---- Header ------------------------------------------------------------- */

function Header({ issue, onSaved }: { issue: Detail; onSaved: (d: Detail) => void }) {
  const { user } = useAuth();
  const [editing, setEditing] = useState(false);
  const [title, setTitle] = useState(issue.title);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    try {
      onSaved(await api.updateIssue(issue.id, { title }));
      setEditing(false);
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    }
  }

  return (
    <header className="det-block mt-5 flex flex-wrap items-end justify-between gap-6">
      <div className="min-w-0 max-w-4xl">
        <p className="eyebrow mb-3 flex flex-wrap items-center gap-2 text-lilac">
          #{issue.id} · {categoryLabel(issue.category)} · {issue.location_name}
        </p>
        {editing ? (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              save();
            }}
            className="flex flex-wrap items-center gap-2"
          >
            <input
              autoFocus
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              maxLength={90}
              aria-label="Issue title"
              className="display-soft min-w-0 flex-1 rounded-2xl bg-ink-2 px-4 py-2 text-4xl outline-none ring-2 ring-lilac"
            />
            <Button type="submit" size="sm">
              Save
            </Button>
            <Button type="button" size="sm" variant="ghost" onClick={() => setEditing(false)}>
              Cancel
            </Button>
          </form>
        ) : (
          <div className="flex flex-wrap items-baseline gap-x-4">
            <h1 className="display text-[clamp(2.4rem,4.6vw,4.4rem)]">{issue.title}</h1>
            {user?.role === "admin" && (
              <button onClick={() => setEditing(true)} className="text-sm text-bone/40 hover:text-bone">
                Rename
              </button>
            )}
          </div>
        )}
        {error && <ErrorNote className="mt-3">{error}</ErrorNote>}
        <div className="mt-4 flex flex-wrap items-center gap-2">
          <StatusPill status={issue.status} />
          <UrgencyTag urgency={issue.urgency} />
          {issue.reopened_count > 0 && (
            <span className="eyebrow rounded-full bg-signal/15 px-2.5 py-1 !text-[0.65rem] text-signal">
              Reopened {issue.reopened_count}× by reporters
            </span>
          )}
          <span className="text-sm text-bone/45">opened {timeAgo(issue.created_at)}</span>
        </div>
      </div>
      <div className="text-right">
        <p className="eyebrow text-bone/40">Priority</p>
        <p className="display text-6xl leading-none">{issue.priority_score.toFixed(1)}</p>
        {issue.breakdown.rank > 0 && <p className="mt-1 text-sm text-bone/50">#{issue.breakdown.rank} of active issues</p>}
      </div>
    </header>
  );
}

/* ---- Why is this ranked here? ------------------------------------------- */

function WhyRanked({ issue }: { issue: Detail }) {
  const b = issue.breakdown;
  const urgencyWord = { 1: "normal", 2: "high", 3: "critical" }[b.urgency_multiplier] ?? "";
  return (
    <Panel className="det-block" title={b.rank > 0 ? `Why is this #${b.rank}?` : "How the priority is worked out"}>
      <div className="grid items-stretch gap-2 sm:grid-cols-[1fr_auto_1fr_auto_1fr_auto_1fr]">
        <Factor label="Recency-weighted reports" value={b.recency_weighted} decimals={1} note={`${b.recent_reports} this week + ${b.older_reports} older × ½`} />
        <Op>×</Op>
        <Factor label="Share negative" value={b.negative_share * 100} decimals={0} suffix="%" note="of reports tied to this issue" />
        <Op>×</Op>
        <Factor label="Urgency" value={b.urgency_multiplier} decimals={0} prefix="×" note={urgencyWord} />
        <Op>=</Op>
        <div className="flex flex-col justify-between rounded-2xl bg-lilac p-4 text-ink">
          <span className="eyebrow">Priority</span>
          <span className="display mt-3 text-5xl leading-none">
            <Counter value={b.score} decimals={1} duration={1.3} />
          </span>
        </div>
      </div>
      <p className="mt-4 text-sm text-bone/45">
        Transparent on purpose: the same formula ranks every issue, and anyone on staff can check the arithmetic.
      </p>
    </Panel>
  );
}

function Factor({ label, value, note, decimals, suffix = "", prefix = "" }: { label: string; value: number; note: string; decimals: number; suffix?: string; prefix?: string }) {
  return (
    <div className="flex flex-col justify-between rounded-2xl bg-bone/[0.04] p-4">
      <span className="text-xs text-bone/50">{label}</span>
      <span className="display mt-3 text-4xl leading-none">
        <Counter value={value} decimals={decimals} suffix={suffix} prefix={prefix} duration={1.1} />
      </span>
      <span className="mt-2 text-xs text-bone/40">{note}</span>
    </div>
  );
}
const Op = ({ children }: { children: string }) => <span className="grid place-items-center font-mono text-xl text-bone/30">{children}</span>;

/* ---- Evidence ----------------------------------------------------------- */

function Evidence({ issue }: { issue: Detail }) {
  const [showMeToo, setShowMeToo] = useState(false);
  const texts = issue.evidence.filter((e) => e.kind === "text");
  const meToo = issue.evidence.filter((e) => e.kind === "me_too");
  const rows = showMeToo ? issue.evidence : texts;
  return (
    <Panel
      className="det-block"
      title="Evidence"
      action={
        <button
          onClick={() => setShowMeToo((s) => !s)}
          aria-pressed={showMeToo}
          className={cn("rounded-full px-3.5 py-1.5 text-xs ring-1", showMeToo ? "bg-bone text-ink ring-bone" : "text-bone/60 ring-bone/15 hover:text-bone")}
        >
          Include “Me too” taps · {meToo.length}
        </button>
      }
    >
      <p className="-mt-2 mb-4 text-sm text-bone/45">The highlighted words are what the analysis read to link each report here.</p>
      {rows.length === 0 ? (
        <Empty title="No written reports yet">Only one-tap “Me too” reports so far.</Empty>
      ) : (
        <ul className="space-y-2">
          {rows.map((e) => (
            <li key={`${e.feedback_id}`} className="rounded-2xl bg-bone/[0.03] p-4">
              {e.kind === "me_too" ? (
                <p className="text-sm text-bone/60">
                  <span className="font-medium text-lilac">Me too</span> tapped at the QR code
                </p>
              ) : (
                <EvidenceText text={e.text_redacted ?? ""} spans={e.evidence_span ? [{ text: e.evidence_span, sentiment: e.sentiment }] : []} />
              )}
              <div className="mt-2 flex flex-wrap items-center gap-3 text-xs text-bone/40">
                <SentimentChip sentiment={e.sentiment} className="!text-xs text-bone/55" />
                <Reporter name={e.reporter_name} phone={e.reporter_phone} />
                {e.kind === "text" && (
                  <span className="rounded bg-bone/[0.06] px-1.5 py-0.5 font-mono text-[0.65rem]" title="Which engine produced the labels">
                    {e.analyzed_by === "llm" ? "LLM" : "Lexicon fallback"}
                  </span>
                )}
                <span className="ml-auto">{timeAgo(e.created_at)}</span>
              </div>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}

/* ---- Actions ------------------------------------------------------------ */

function Actions({ issue, onSaved }: { issue: Detail; onSaved: (d: Detail) => void }) {
  const { user } = useAuth();
  const isAdmin = user?.role === "admin";
  const [staff, setStaff] = useState<User[]>([]);
  const [response, setResponse] = useState(issue.public_response ?? "");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [needsResponse, setNeedsResponse] = useState(false);
  const panel = useRef<HTMLDivElement>(null);
  const next = NEXT[issue.status];

  useEffect(() => {
    if (!isAdmin) return;
    let alive = true;
    api.staff().then((s) => alive && setStaff(s)).catch(() => {});
    return () => {
      alive = false;
    };
  }, [isAdmin]);

  useEffect(() => setResponse(issue.public_response ?? ""), [issue.public_response]);

  async function run(label: string, patch: IssueUpdate) {
    setBusy(label);
    setError(null);
    try {
      const d = await api.updateIssue(issue.id, patch);
      onSaved(d);
      setNeedsResponse(false);
      if (patch.status === "resolved") {
        pulseFrom(panel.current, 2.2);
        if (!prefersReducedMotion())
          gsap.fromTo(panel.current, { boxShadow: "0 0 0 8px rgba(143,240,174,.45)" }, { boxShadow: "0 0 0 0 rgba(143,240,174,0)", duration: 1.8 });
      }
    } catch (e) {
      const err = e as Error & { fields?: Record<string, string> };
      if (err.fields?.public_response === "required") setNeedsResponse(true);
      setError(err.message);
    } finally {
      setBusy(null);
    }
  }

  const stepIndex = issue.status === "reopened" ? 2 : STATUS_ORDER.indexOf(issue.status);
  const t = issue.verification;
  const votes = t.fixed + t.not_fixed;

  return (
    <div ref={panel} className="det-block rounded-[1.75rem] bg-ink-2 p-5 ring-1 ring-bone/[0.06] sm:p-6">
      <h2 className="display-soft mb-5 text-xl">Move it forward</h2>

      {/* Stepper */}
      <ol className="mb-6 grid grid-cols-4 gap-1.5">
        {STATUS_ORDER.map((s, i) => (
          <li key={s} className="text-center">
            <span
              className={cn(
                "mb-2 block h-1.5 rounded-full transition-colors duration-700",
                i <= stepIndex ? (issue.status === "reopened" && i === 2 ? "bg-signal" : i === 3 ? "bg-mint" : "bg-lilac") : "bg-bone/10",
              )}
            />
            <span className={cn("text-[0.7rem]", i === stepIndex ? "text-bone" : "text-bone/40")}>{STATUS_LABEL[s]}</span>
          </li>
        ))}
      </ol>

      {issue.status === "reopened" && (
        <p className="mb-5 rounded-2xl bg-signal/12 p-4 text-sm text-signal">
          Reporters said this isn't fixed ({t.not_fixed} of {votes}). Fix it again, update the public response, then resolve.
        </p>
      )}

      {/* Public response */}
      <label htmlFor="response" className="mb-2 flex items-center justify-between text-sm text-bone/60">
        Public response
        <span className="font-mono text-xs text-bone/35">{response.length}/500</span>
      </label>
      <textarea
        id="response"
        value={response}
        onChange={(e) => {
          setResponse(e.target.value);
          setNeedsResponse(false);
        }}
        rows={4}
        maxLength={500}
        placeholder="What did you do? Reporters and the public page will see this."
        className={cn(
          "w-full resize-none rounded-2xl bg-ink px-4 py-3 leading-relaxed outline-none ring-1 ring-bone/10 transition focus:ring-2 focus:ring-lilac",
          needsResponse && "ring-2 ring-signal",
        )}
      />
      <div className="mt-2 flex justify-end">
        <button
          onClick={() => run("response", { public_response: response })}
          disabled={busy !== null || response === (issue.public_response ?? "")}
          className="text-sm text-lilac disabled:text-bone/25"
        >
          {busy === "response" ? "Saving…" : "Save response"}
        </button>
      </div>

      {error && <ErrorNote className="mt-3">{error}</ErrorNote>}

      {next && (
        <Button
          size="lg"
          variant={next.to === "resolved" ? "mint" : "bone"}
          className="mt-4 w-full"
          disabled={busy !== null}
          onClick={() =>
            run("status", {
              status: next.to,
              ...(next.to === "resolved" && response !== (issue.public_response ?? "") ? { public_response: response } : {}),
            })
          }
        >
          {busy === "status" ? <Spinner /> : next.label}
        </Button>
      )}
      {issue.status === "resolved" && (
        <div className="mt-4 rounded-2xl bg-mint/10 p-4">
          <p className="text-sm text-mint">Resolved. Reporters are being asked if it's actually fixed.</p>
          <div className="mt-3 flex h-2 overflow-hidden rounded-full bg-bone/10">
            {votes > 0 && (
              <>
                <span className="bg-[#5fd98a]" style={{ width: `${(t.fixed / votes) * 100}%` }} />
                <span className="bg-signal" style={{ width: `${(t.not_fixed / votes) * 100}%` }} />
              </>
            )}
          </div>
          <p className="mt-2 font-mono text-xs text-bone/55">
            {votes ? `${t.fixed} fixed · ${t.not_fixed} not fixed` : "No votes yet"} · reopens at 30% “not fixed”, min 3 votes
          </p>
        </div>
      )}

      {/* Assignment */}
      <div className="mt-6 border-t border-bone/[0.06] pt-5">
        <p className="mb-2 text-sm text-bone/60">Assigned to</p>
        {isAdmin ? (
          <select
            aria-label="Assign to team"
            value={issue.assignee?.id ?? ""}
            disabled={busy !== null}
            onChange={(e) => {
              // Send the id as the API gave it: a UUID string from the backend, a number in mock mode
              const picked = staff.find((s) => String(s.id) === e.target.value);
              run("assign", { assignee_id: picked ? picked.id : null });
            }}
            className="h-12 w-full rounded-2xl bg-ink px-4 outline-none ring-1 ring-bone/10 focus:ring-2 focus:ring-lilac"
          >
            <option value="">Unassigned</option>
            {staff.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name} · {s.team}
              </option>
            ))}
          </select>
        ) : (
          <p>{issue.assignee?.name ?? "Unassigned"}</p>
        )}
      </div>
    </div>
  );
}

/* ---- Timeline ----------------------------------------------------------- */

function Timeline({ issue }: { issue: Detail }) {
  return (
    <Panel className="det-block" title="Audit trail">
      <ol className="relative pl-6">
        <span className="absolute bottom-2 left-[5px] top-2 w-px bg-bone/10" />
        {[...issue.events].reverse().map((e) => (
          <li key={e.id} className="relative pb-4 last:pb-0">
            <span
              className={cn(
                "absolute -left-6 top-1.5 h-[11px] w-[11px] rounded-full ring-4 ring-ink-2",
                e.to_status === "reopened" ? "bg-signal" : e.to_status === "resolved" ? "bg-mint" : "bg-lilac",
              )}
            />
            <p className="text-sm">
              {e.from_status === e.to_status ? e.note : STATUS_LABEL[e.to_status]}
              <span className="text-bone/40"> · {e.actor}</span>
            </p>
            <p className="text-xs text-bone/40">
              {timeAgo(e.created_at)}
              {e.from_status !== e.to_status && e.note && <span className="text-bone/55"> · {e.note}</span>}
            </p>
          </li>
        ))}
      </ol>
    </Panel>
  );
}
