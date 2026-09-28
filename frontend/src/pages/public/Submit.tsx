import { useEffect, useRef, useState, type FormEvent } from "react";
import { Link, useParams } from "react-router-dom";
import { DitherField, pulseFrom } from "@/components/fx/DitherField";
import { Arrow, Button, ButtonLink, ErrorNote, Logo, SentimentChip, Spinner, StatusPill, UrgencyTag } from "@/components/ui/kit";
import { api, ApiError } from "@/lib/api";
import { deviceId, saveCode } from "@/lib/device";
import { gsap, useGSAP, prefersReducedMotion } from "@/lib/gsap";
import type { IssueSummary, Location, SubmitFeedbackResult } from "@/lib/types";
import { cn } from "@/lib/cn";

const MIN = 10;
const MAX = 1000;

export default function Submit() {
  const { slug = "" } = useParams();
  const [location, setLocation] = useState<Location | null>(null);
  const [issues, setIssues] = useState<IssueSummary[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [result, setResult] = useState<SubmitFeedbackResult | null>(null);

  useEffect(() => {
    let alive = true;
    setLocation(null);
    setIssues(null);
    setLoadError(null);
    api
      .location(slug)
      .then((l) => {
        if (!alive) return;
        setLocation(l);
        return api.locationIssues(slug).then((i) => alive && setIssues(i));
      })
      .catch((e: Error) => alive && setLoadError(e.message));
    return () => {
      alive = false;
    };
  }, [slug]);

  if (result && location) return <Heard result={result} location={location} onAgain={() => setResult(null)} />;

  return (
    <div className="min-h-[100svh] bg-bone text-ink">
      <Header location={location} error={loadError} />
      {location && (
        <main className="mx-auto max-w-xl px-5 pb-20 sm:px-6">
          <KnownIssues issues={issues} />
          <FeedbackForm location={location} onDone={setResult} hasIssues={!!issues?.length} />
        </main>
      )}
    </div>
  );
}

/* ---------- Header ------------------------------------------------------ */

function Header({ location, error }: { location: Location | null; error: string | null }) {
  const ref = useRef<HTMLElement>(null);
  useGSAP(
    () => {
      if (!location || prefersReducedMotion()) return;
      gsap.from(".loc-name", { yPercent: 110, duration: 1.2, delay: 0.1 });
      gsap.from(".loc-meta", { opacity: 0, y: 12, duration: 1, delay: 0.35 });
    },
    { scope: ref, dependencies: [location?.id] },
  );
  return (
    <header ref={ref} className="relative overflow-hidden rounded-b-[2.25rem] bg-cobalt text-bone">
      <DitherField cell={5} palette={["#2a1dd9", "#5446ff", "#9b91ff"]} sources={[{ x: 0.95, y: 0.1, strength: 1.2 }]} floor={0.2} glow={90} />
      <div className="relative z-10 mx-auto max-w-xl px-5 pb-10 pt-5 sm:px-6">
        <div className="flex items-center justify-between">
          <Logo />
          <Link to="/track" className="rounded-full bg-bone/10 px-4 py-2 text-sm backdrop-blur hover:bg-bone/20">
            My reports
          </Link>
        </div>
        <div className="mt-16">
          {error ? (
            <>
              <p className="eyebrow mb-3 text-lilac">Hmm</p>
              <h1 className="display text-5xl">Unknown place</h1>
              <p className="mt-4 text-bone/70">{error}</p>
              <ButtonLink to="/report" className="mt-6" size="sm">
                Pick a location
              </ButtonLink>
            </>
          ) : location ? (
            <>
              <p className="loc-meta eyebrow mb-3 text-lilac">You're at · {location.zone}</p>
              <div className="overflow-hidden pb-1">
                <h1 className="loc-name display text-[clamp(3.2rem,15vw,5.5rem)]">{location.name}</h1>
              </div>
            </>
          ) : (
            <div className="space-y-3">
              <div className="h-3 w-32 animate-pulse rounded bg-bone/20" />
              <div className="h-16 w-4/5 animate-pulse rounded-2xl bg-bone/15" />
            </div>
          )}
        </div>
      </div>
    </header>
  );
}

/* ---------- Known issues + Me too -------------------------------------- */

function KnownIssues({ issues }: { issues: IssueSummary[] | null }) {
  const ref = useRef<HTMLElement>(null);
  useGSAP(
    () => {
      if (!issues?.length || prefersReducedMotion()) return;
      gsap.from(".known-card", { y: 30, opacity: 0, stagger: 0.1, duration: 0.9, delay: 0.2 });
    },
    { scope: ref, dependencies: [issues?.map((i) => i.id).join()] },
  );

  if (!issues) {
    return (
      <div className="mt-8 space-y-3">
        {[0, 1].map((i) => (
          <div key={i} className="h-28 animate-pulse rounded-[1.5rem] bg-ink/5" />
        ))}
      </div>
    );
  }
  if (!issues.length) return null;

  return (
    <section ref={ref} className="mt-8">
      <p className="eyebrow mb-2 text-ink/50">Known issues here</p>
      <p className="mb-5 text-ink/70">Already reported? Add your voice with one tap instead of typing it again.</p>
      <ul className="space-y-3">
        {issues.map((i) => (
          <MeTooCard key={i.id} issue={i} />
        ))}
      </ul>
    </section>
  );
}

function MeTooCard({ issue }: { issue: IssueSummary }) {
  const [count, setCount] = useState(issue.report_count);
  const [code, setCode] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const ref = useRef<HTMLLIElement>(null);
  const countRef = useRef<HTMLSpanElement>(null);

  async function add() {
    setBusy(true);
    setError(null);
    try {
      const r = await api.meToo(issue.id, deviceId());
      saveCode(r.tracking_code, issue.title);
      setCode(r.tracking_code);
      // Old number rolls up and out, new one rolls in
      if (countRef.current && !prefersReducedMotion()) {
        await gsap.to(countRef.current, { yPercent: -100, opacity: 0, duration: 0.25, ease: "power2.in" });
        setCount(r.report_count);
        gsap.fromTo(countRef.current, { yPercent: 100, opacity: 0 }, { yPercent: 0, opacity: 1, duration: 0.6 });
      } else setCount(r.report_count);
      pulseFrom(ref.current, 1.4);
      if (!prefersReducedMotion()) gsap.fromTo(ref.current, { scale: 0.98 }, { scale: 1, duration: 0.8, ease: "elastic.out(1,0.5)" });
    } catch (e) {
      if (e instanceof ApiError && e.code === "ALREADY_REPORTED") {
        setCode(e.fields?.tracking_code ?? null);
        setError(null);
      } else setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <li ref={ref} className={cn("known-card rounded-[1.5rem] p-5 transition-colors duration-500", code ? "bg-ink text-bone" : "bg-white")}>
      <div className="mb-3 flex items-center justify-between gap-3">
        <StatusPill status={issue.status} light={!code} />
        <UrgencyTag urgency={issue.urgency} />
      </div>
      <h3 className="display-soft text-[1.6rem] leading-tight">{issue.title}</h3>
      <div className="mt-5 flex items-center justify-between gap-4">
        <p className={cn("flex items-baseline gap-1.5", code ? "text-bone/70" : "text-ink/60")}>
          <span className="inline-block overflow-hidden align-bottom">
            <span ref={countRef} className={cn("inline-block font-mono text-2xl tabular", code ? "text-bone" : "text-ink")}>
              {count}
            </span>
          </span>
          reports
        </p>
        {code ? (
          <Link to={`/track/${code}`} className="rounded-full bg-mint px-4 py-2.5 text-sm font-medium text-ink">
            You're in · {code}
          </Link>
        ) : (
          <Button variant="cobalt" size="sm" className="h-11 px-5" onClick={add} disabled={busy}>
            {busy ? <Spinner /> : "Me too"}
          </Button>
        )}
      </div>
      {error && <ErrorNote className="mt-3">{error}</ErrorNote>}
    </li>
  );
}

/* ---------- Form -------------------------------------------------------- */

function FeedbackForm({ location, onDone, hasIssues }: { location: Location; onDone: (r: SubmitFeedbackResult) => void; hasIssues: boolean }) {
  const [text, setText] = useState("");
  const [website, setWebsite] = useState("");
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [phoneError, setPhoneError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [touched, setTouched] = useState(false);
  const area = useRef<HTMLTextAreaElement>(null);
  const len = text.trim().length;
  const tooShort = len < MIN;
  const tooLong = len > MAX;

  // Grow the textarea with its content
  useEffect(() => {
    const el = area.current;
    if (!el) return;
    el.style.height = "0px";
    el.style.height = `${Math.max(150, el.scrollHeight)}px`;
  }, [text]);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setTouched(true);
    if (tooShort || tooLong) return;
    const digits = phone.replace(/\D/g, "").length;
    if (phone.trim() && (!/^\+?[\d\s()-]+$/.test(phone.trim()) || digits < 7 || digits > 15)) {
      setPhoneError("That phone number doesn't look right.");
      return;
    }
    setBusy(true);
    setError(null);
    setPhoneError(null);
    try {
      const r = await api.submitFeedback({
        text,
        location_slug: location.slug,
        website,
        name: name.trim() || undefined,
        phone: phone.trim() || undefined,
      });
      saveCode(r.tracking_code, `${location.name}: ${text.slice(0, 40)}${text.length > 40 ? "…" : ""}`);
      onDone(r);
    } catch (err) {
      const e = err as ApiError;
      if (e.fields?.phone) setPhoneError(e.message);
      else setError(e.fields?.text === "too_short" ? `Tell us a little more: at least ${MIN} characters.` : e.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} noValidate className="mt-10">
      <label htmlFor="feedback" className="eyebrow mb-2 block text-ink/50">
        {hasIssues ? "Or tell us something new" : "Tell us what's going on"}
      </label>
      <p className="mb-4 text-ink/70">Good or bad. Say it the way you'd say it to a friend.</p>

      <div
        className={cn(
          "rounded-[1.5rem] bg-white p-1.5 ring-2 transition-[box-shadow] focus-within:ring-cobalt",
          touched && (tooShort || tooLong) ? "ring-signal" : "ring-transparent",
        )}
      >
        <textarea
          ref={area}
          id="feedback"
          value={text}
          onChange={(e) => setText(e.target.value)}
          onBlur={() => len > 0 && setTouched(true)}
          maxLength={MAX + 200}
          placeholder={`e.g. The Wi-Fi at ${location.name} keeps dropping after 10 pm`}
          className="block w-full resize-none rounded-[1.2rem] bg-transparent px-4 py-4 text-lg leading-relaxed outline-none placeholder:text-ink/30"
          aria-describedby="feedback-help"
          aria-invalid={touched && (tooShort || tooLong)}
        />
        <div className="flex items-center justify-between px-4 pb-2.5 pt-1">
          <span id="feedback-help" className={cn("text-xs", touched && tooShort ? "text-[#c53d0c]" : "text-ink/45")}>
            {touched && tooShort ? `At least ${MIN} characters` : "Numbers and emails in here are removed."}
          </span>
          <span className={cn("font-mono text-xs tabular", tooLong ? "text-[#c53d0c]" : "text-ink/40")}>
            {len}/{MAX}
          </span>
        </div>
      </div>

      <fieldset className="mt-6">
        <legend className="eyebrow mb-2 block text-ink/50">Your details · optional</legend>
        <p className="mb-3 text-sm text-ink/60">So staff can reach you about this. Only they see it, never the public.</p>
        <div className="grid gap-2 sm:grid-cols-2">
          <label className="sr-only" htmlFor="reporter-name">
            Name
          </label>
          <input
            id="reporter-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            maxLength={80}
            autoComplete="name"
            placeholder="Name"
            className="h-14 rounded-[1.2rem] bg-white px-4 text-lg outline-none ring-2 ring-transparent placeholder:text-ink/30 focus:ring-cobalt"
          />
          <label className="sr-only" htmlFor="reporter-phone">
            Phone number
          </label>
          <input
            id="reporter-phone"
            type="tel"
            inputMode="tel"
            value={phone}
            onChange={(e) => {
              setPhone(e.target.value);
              setPhoneError(null);
            }}
            maxLength={20}
            autoComplete="tel"
            placeholder="Phone number"
            aria-invalid={!!phoneError}
            aria-describedby={phoneError ? "phone-error" : undefined}
            className={cn(
              "h-14 rounded-[1.2rem] bg-white px-4 text-lg outline-none ring-2 placeholder:text-ink/30 focus:ring-cobalt",
              phoneError ? "ring-signal" : "ring-transparent",
            )}
          />
        </div>
        {phoneError && (
          <p id="phone-error" className="mt-2 text-xs text-[#c53d0c]">
            {phoneError}
          </p>
        )}
      </fieldset>

      {/* Honeypot: invisible to people, tempting to bots */}
      <div aria-hidden className="absolute -left-[9999px] h-px w-px overflow-hidden">
        <label htmlFor="website">Website</label>
        <input id="website" tabIndex={-1} autoComplete="off" value={website} onChange={(e) => setWebsite(e.target.value)} />
      </div>

      {error && <ErrorNote className="mt-4">{error}</ErrorNote>}

      <Button type="submit" variant="ink" size="lg" className="mt-5 w-full" disabled={busy} icon={busy ? undefined : <Arrow />}>
        {busy ? (
          <span className="flex items-center gap-3">
            <Spinner /> Listening…
          </span>
        ) : (
          "Send it"
        )}
      </Button>
      <p className="mt-4 text-center text-xs text-ink/45">You'll get a tracking code. No account needed.</p>
    </form>
  );
}

/* ---------- Success ----------------------------------------------------- */

function Heard({ result, location, onAgain }: { result: SubmitFeedbackResult; location: Location; onAgain: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const [copied, setCopied] = useState(false);

  useGSAP(
    () => {
      if (prefersReducedMotion()) return;
      const tl = gsap.timeline();
      tl.from(".heard-title", { yPercent: 110, duration: 1.2 })
        .from(".code-char", { yPercent: 100, opacity: 0, stagger: 0.06, duration: 0.7 }, "-=0.7")
        .from(".heard-aspect", { y: 30, opacity: 0, stagger: 0.12, duration: 0.8 }, "-=0.3")
        .from(".heard-actions", { y: 20, opacity: 0, duration: 0.8 }, "-=0.4");
      // A big ripple from the centre, then its echo
      requestAnimationFrame(() => {
        const r = ref.current?.getBoundingClientRect();
        if (r) window.dispatchEvent(new CustomEvent("echo:pulse", { detail: { x: r.width / 2, y: r.height * 0.35, strength: 2.2 } }));
      });
    },
    { scope: ref },
  );

  async function copy() {
    try {
      await navigator.clipboard.writeText(result.tracking_code);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      /* clipboard blocked; the code is on screen anyway */
    }
  }

  return (
    <div ref={ref} className="relative min-h-[100svh] overflow-hidden bg-ink text-bone">
      <DitherField cell={6} palette={["#1c1466", "#3b2bff", "#8a7fff", "#d9d4ff"]} sources={[{ x: 0.5, y: 0.35, strength: 1.2 }]} floor={0.3} />
      <div className="relative z-10 mx-auto flex min-h-[100svh] max-w-xl flex-col px-5 pb-10 pt-5 sm:px-6">
        <Logo />
        <div className="mt-20 overflow-hidden">
          <h1 className="heard-title display text-[clamp(5rem,26vw,9rem)]">
            Heard<span className="text-lilac">.</span>
          </h1>
        </div>
        <p className="mt-4 text-bone/70">Your report from {location.name} is in. Keep this code to follow what happens next.</p>

        <button
          type="button"
          onClick={copy}
          className="group mt-8 flex items-center justify-between rounded-[1.5rem] bg-bone/[0.07] px-6 py-5 text-left ring-1 ring-bone/15 backdrop-blur hover:bg-bone/10"
        >
          <span>
            <span className="eyebrow block text-bone/50">Tracking code</span>
            <span className="mt-1 flex overflow-hidden font-mono text-4xl tracking-[0.08em]">
              {result.tracking_code.split("").map((c, i) => (
                <span key={i} className="code-char inline-block">
                  {c}
                </span>
              ))}
            </span>
          </span>
          <span className="rounded-full bg-bone px-3 py-1.5 text-xs font-medium text-ink">{copied ? "Copied" : "Copy"}</span>
        </button>
        <p className="mt-2 text-xs text-bone/45">Saved on this phone too, under My reports.</p>

        {result.aspects.length > 0 && (
          <section className="mt-10">
            <p className="eyebrow mb-3 text-bone/50">What we understood</p>
            <ul className="space-y-2.5">
              {result.aspects.map((a) => (
                <li key={a.id} className="heard-aspect rounded-2xl bg-bone/[0.06] p-4 ring-1 ring-bone/10">
                  <div className="mb-2 flex flex-wrap items-center gap-2">
                    <span className="font-medium">{a.aspect}</span>
                    <SentimentChip sentiment={a.sentiment} className="text-bone/80" />
                    <UrgencyTag urgency={a.urgency} />
                  </div>
                  <p className="serif-accent text-lg text-bone/80">“{a.evidence_span}”</p>
                  {a.issue_id && <p className="mt-2 font-mono text-xs text-lilac">→ joined an existing issue other people reported</p>}
                </li>
              ))}
            </ul>
          </section>
        )}

        <div className="heard-actions mt-auto flex flex-col gap-3 pt-10 sm:flex-row">
          <ButtonLink to={`/track/${result.tracking_code}`} size="lg" className="flex-1" icon={<Arrow />}>
            Follow it
          </ButtonLink>
          <Button size="lg" variant="ghost" className="flex-1" onClick={onAgain}>
            Report something else
          </Button>
        </div>
      </div>
    </div>
  );
}
