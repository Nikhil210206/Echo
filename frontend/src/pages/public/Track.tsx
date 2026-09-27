import { useEffect, useRef, useState, type FormEvent } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { PublicNav } from "@/components/layout/PublicNav";
import { pulseFrom } from "@/components/fx/DitherField";
import { SplitReveal } from "@/components/fx/motion";
import { Arrow, Button, ErrorNote, SentimentChip, Spinner, StatusPill, UrgencyTag } from "@/components/ui/kit";
import { api, USE_MOCKS } from "@/lib/api";
import { savedCodes } from "@/lib/device";
import { categoryLabel, STATUS_LABEL, timeAgo } from "@/lib/format";
import { gsap, useGSAP, prefersReducedMotion } from "@/lib/gsap";
import type { TrackedIssue, TrackResult } from "@/lib/types";
import { mock } from "@/mocks/store";
import { cn } from "@/lib/cn";

const POLL_MS = 5000;

export default function Track() {
  const { code } = useParams();
  return (
    <>
      <PublicNav tone="light" />
      <main className="min-h-[100svh] bg-bone px-5 pb-24 pt-28 text-ink sm:px-8">
        <div className="mx-auto max-w-3xl">{code ? <Tracking code={code.toUpperCase()} /> : <Lookup />}</div>
      </main>
    </>
  );
}

/* ---------- Code entry -------------------------------------------------- */

function Lookup() {
  const nav = useNavigate();
  const [value, setValue] = useState("");
  const [error, setError] = useState<string | null>(null);
  const mine = savedCodes();

  function go(e: FormEvent) {
    e.preventDefault();
    const c = value.trim().toUpperCase();
    if (!c) {
      setError("Please enter your tracking code.");
      return;
    }
    const clean = c.replace(/[^A-Z0-9-]/g, "");
    if (clean.length < 4 || clean.length > 20) {
      setError("Please enter a valid tracking code (e.g. V9Y8NEP9 or ECH-7K2Q).");
      return;
    }
    nav(`/track/${encodeURIComponent(clean)}`);
  }

  return (
    <>
      <p className="eyebrow mb-5 text-ink/50">Track a report</p>
      <SplitReveal as="h1" className="display text-[clamp(3rem,10vw,7rem)]">
        What happened <span className="serif-accent text-cobalt">to mine?</span>
      </SplitReveal>

      <form onSubmit={go} className="mt-10" noValidate>
        <label htmlFor="code" className="sr-only">
          Tracking code
        </label>
        <div className="flex items-center gap-2 rounded-full bg-white p-2 pl-6 ring-2 ring-transparent focus-within:ring-cobalt">
          <input
            id="code"
            value={value}
            onChange={(e) => {
              setValue(e.target.value.toUpperCase().slice(0, 20));
              setError(null);
            }}
            autoCapitalize="characters"
            autoComplete="off"
            spellCheck={false}
            placeholder="e.g. V9Y8NEP9 or ECH-7K2Q"
            className="min-w-0 flex-1 bg-transparent font-mono text-xl tracking-[0.05em] outline-none placeholder:text-ink/20"
          />
          <Button type="submit" variant="ink" icon={<Arrow />}>
            Track
          </Button>
        </div>
        {error && <ErrorNote className="mt-3">{error}</ErrorNote>}
      </form>

      <section className="mt-14">
        <p className="eyebrow mb-4 text-ink/50">On this phone</p>
        {mine.length ? (
          <ul className="divide-y divide-ink/10 rounded-[1.5rem] bg-white">
            {mine.map((c) => (
              <li key={c.code}>
                <Link to={`/track/${c.code}`} className="flex items-center justify-between gap-4 px-5 py-4 hover:bg-bone-2/50">
                  <span className="min-w-0">
                    <span className="block font-mono text-lg">{c.code}</span>
                    <span className="block truncate text-sm text-ink/55">{c.label}</span>
                  </span>
                  <span className="shrink-0 text-sm text-ink/40">{timeAgo(c.at)}</span>
                </Link>
              </li>
            ))}
          </ul>
        ) : (
          <p className="rounded-[1.5rem] bg-white px-5 py-6 text-ink/55">
            Nothing yet. Reports you send from this phone show up here automatically.
            {USE_MOCKS && (
              <>
                {" "}
                Try <Link className="font-mono text-cobalt underline" to="/track/ECH-DEMO">ECH-DEMO</Link>.
              </>
            )}
          </p>
        )}
      </section>
    </>
  );
}

/* ---------- One report -------------------------------------------------- */

function Tracking({ code }: { code: string }) {
  const [data, setData] = useState<TrackResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Poll so status changes show up live, e.g. during the demo
  useEffect(() => {
    let alive = true;
    const load = () =>
      api
        .track(code)
        .then((d) => {
          if (!alive) return;
          setData(d);
          setError(null);
        })
        .catch((e: Error) => alive && setError(e.message));
    setData(null);
    load();
    const id = setInterval(() => document.visibilityState === "visible" && load(), POLL_MS);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, [code]);

  if (error && !data)
    return (
      <div>
        <p className="eyebrow mb-4 text-ink/50">Tracking {code}</p>
        <ErrorNote>{error}</ErrorNote>
        <Link to="/track" className="mt-6 inline-block text-cobalt underline">
          Try another code
        </Link>
      </div>
    );
  if (!data)
    return (
      <div className="space-y-4">
        <div className="h-4 w-40 animate-pulse rounded bg-ink/10" />
        <div className="h-24 w-3/4 animate-pulse rounded-3xl bg-ink/10" />
        <div className="h-72 animate-pulse rounded-[2rem] bg-ink/5" />
      </div>
    );

  return (
    <>
      <p className="eyebrow mb-4 text-ink/50">
        Tracking · {data.kind === "me_too" ? "“Me too”" : "Your report"} · {data.location_name} · {timeAgo(data.submitted_at)}
      </p>
      <h1 className="font-mono text-[clamp(2.8rem,11vw,6rem)] font-medium leading-none tracking-[0.02em]">{data.tracking_code}</h1>

      {data.aspects.length > 0 && (
        <div className="mt-8 flex flex-wrap gap-2">
          {data.aspects.map((a) => (
            <span key={a.id} className="inline-flex items-center gap-2 rounded-full bg-white px-3.5 py-2 text-sm">
              {a.aspect} <SentimentChip sentiment={a.sentiment} className="text-ink/60" />
              <UrgencyTag urgency={a.urgency} />
            </span>
          ))}
        </div>
      )}

      {data.issues.length === 0 ? (
        <p className="mt-10 rounded-[1.5rem] bg-white p-6 text-ink/65">
          Your feedback was recorded. It didn't match a known problem, so it's counted in the reports without being grouped into an issue yet.
        </p>
      ) : (
        <div className="mt-10 space-y-5">
          {data.issues.map((i) => (
            <IssueTrack key={i.id} issue={i} code={data.tracking_code} onChange={setData} />
          ))}
        </div>
      )}
    </>
  );
}

function IssueTrack({ issue, code, onChange }: { issue: TrackedIssue; code: string; onChange: (d: TrackResult) => void }) {
  const ref = useRef<HTMLElement>(null);
  const prevStatus = useRef(issue.status);
  const others = issue.report_count - 1;

  useGSAP(
    () => {
      if (prefersReducedMotion()) return;
      gsap.from(".tl-line", { scaleY: 0, duration: 1.4, ease: "power2.inOut" });
      gsap.from(".tl-item", { x: -16, opacity: 0, stagger: 0.12, duration: 0.8, delay: 0.2 });
    },
    { scope: ref },
  );

  // Flash when the status changes while you're watching
  useEffect(() => {
    if (prevStatus.current !== issue.status) {
      prevStatus.current = issue.status;
      pulseFrom(ref.current, 2);
      if (!prefersReducedMotion())
        gsap.fromTo(ref.current, { boxShadow: "0 0 0 6px rgba(59,43,255,.35)" }, { boxShadow: "0 0 0 0px rgba(59,43,255,0)", duration: 1.6 });
    }
  }, [issue.status]);

  return (
    <article ref={ref} className="overflow-hidden rounded-[2rem] bg-white">
      {issue.status === "reopened" && (
        <div className="bg-signal px-6 py-3 text-sm font-medium text-ink sm:px-8">
          Reopened. Enough reporters said it isn't fixed, so it's back with the team.
        </div>
      )}
      <div className="p-6 sm:p-8">
        <div className="mb-4 flex flex-wrap items-center gap-2">
          <StatusPill status={issue.status} light />
          <span className="eyebrow text-ink/45">
            {categoryLabel(issue.category)} · {issue.location_name}
          </span>
        </div>
        <h2 className="display-soft text-[clamp(1.8rem,5vw,2.6rem)]">{issue.title}</h2>
        <p className="mt-3 text-lg text-ink/65">
          {others > 0 ? (
            <>
              You and <span className="font-mono text-ink">{others}</span> {others === 1 ? "other" : "others"} reported this.
            </>
          ) : (
            "You're the first to report this."
          )}
        </p>

        {issue.public_response && (
          <blockquote className="mt-6 rounded-[1.5rem] bg-cobalt p-5 text-bone">
            <p className="eyebrow mb-2 text-lilac">Public response</p>
            <p className="serif-accent text-[1.35rem] leading-snug">“{issue.public_response}”</p>
          </blockquote>
        )}

        {(issue.can_verify || issue.my_vote !== null) && <Verify issue={issue} code={code} onChange={onChange} />}

        <ol className="relative mt-8 pl-6">
          <span className="tl-line absolute bottom-2 left-[5px] top-2 w-px origin-top bg-ink/15" />
          {[...issue.timeline].reverse().map((e, idx) => (
            <li key={e.id} className="tl-item relative pb-5 last:pb-0">
              <span
                className={cn(
                  "absolute -left-6 top-1.5 h-[11px] w-[11px] rounded-full ring-4 ring-white",
                  e.to_status === "reopened" ? "bg-signal" : e.to_status === "resolved" ? "bg-mint-deep" : idx === 0 ? "bg-cobalt" : "bg-ink/25",
                )}
              />
              <p className="font-medium">{STATUS_LABEL[e.to_status]}</p>
              <p className="text-sm text-ink/50">
                {e.actor} · {timeAgo(e.created_at)}
                {e.note && <span className="text-ink/70"> · {e.note}</span>}
              </p>
            </li>
          ))}
        </ol>
      </div>
      {USE_MOCKS && import.meta.env.DEV && <DemoControls issue={issue} code={code} onChange={onChange} />}
    </article>
  );
}

function Verify({ issue, code, onChange }: { issue: TrackedIssue; code: string; onChange: (d: TrackResult) => void }) {
  const [busy, setBusy] = useState<null | boolean>(null);
  const [error, setError] = useState<string | null>(null);
  const t = issue.verification;
  const total = t.fixed + t.not_fixed;

  async function vote(fixed: boolean) {
    setBusy(fixed);
    setError(null);
    try {
      onChange(await api.verify(code, issue.id, fixed));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  if (issue.my_vote !== null) {
    return (
      <div className="mt-6 rounded-[1.5rem] bg-bone p-5">
        <p className="font-medium">
          You said: {issue.my_vote ? "fixed" : "not fixed"}. {issue.status === "reopened" ? "It's been reopened." : "Thanks for checking."}
        </p>
        {total > 0 && (
          <>
            <div className="mt-4 flex h-2.5 overflow-hidden rounded-full bg-ink/10">
              <span className="bg-mint-deep" style={{ width: `${(t.fixed / total) * 100}%` }} />
              <span className="bg-signal" style={{ width: `${(t.not_fixed / total) * 100}%` }} />
            </div>
            <p className="mt-2 font-mono text-xs text-ink/55">
              {t.fixed} fixed · {t.not_fixed} not fixed
            </p>
          </>
        )}
      </div>
    );
  }

  return (
    <div className="mt-6 rounded-[1.5rem] bg-ink p-6 text-bone">
      <p className="display-soft text-3xl">Was it actually fixed?</p>
      <p className="mt-2 text-sm text-bone/60">Only people who reported this can answer. If 30% say no, it reopens.</p>
      <div className="mt-5 grid grid-cols-2 gap-3">
        <Button variant="mint" size="lg" onClick={() => vote(true)} disabled={busy !== null}>
          {busy === true ? <Spinner /> : "Yes, fixed"}
        </Button>
        <Button variant="signal" size="lg" onClick={() => vote(false)} disabled={busy !== null}>
          {busy === false ? <Spinner /> : "Not fixed"}
        </Button>
      </div>
      {error && <ErrorNote className="mt-3">{error}</ErrorNote>}
    </div>
  );
}

/** Dev-only: act as staff on the mock store so the whole loop can be clicked through. */
function DemoControls({ issue, code, onChange }: { issue: TrackedIssue; code: string; onChange: (d: TrackResult) => void }) {
  const act = (fn: () => void) => {
    fn();
    onChange(mock.track(code));
  };
  return (
    <div className="flex flex-wrap items-center gap-2 border-t border-dashed border-ink/15 bg-bone-2/40 px-6 py-3 text-xs sm:px-8">
      <span className="eyebrow text-ink/45">Dev · act as staff</span>
      {issue.status !== "resolved" && (
        <button
          className="rounded-full bg-ink px-3 py-1.5 text-bone"
          onClick={() => act(() => mock.setStatus(issue.id, "resolved", "IT services", "New access point installed on floors 2–4."))}
        >
          Resolve
        </button>
      )}
      {issue.status === "resolved" && (
        <button className="rounded-full bg-ink px-3 py-1.5 text-bone" onClick={() => act(() => mock.addSeedVotes(issue.id, [true, true]))}>
          Add 2 “fixed” votes from others
        </button>
      )}
    </div>
  );
}
