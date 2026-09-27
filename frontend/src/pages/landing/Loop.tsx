import { useRef, type ReactNode } from "react";
import { gsap, useGSAP, ScrollTrigger, prefersReducedMotion } from "@/lib/gsap";
import { cn } from "@/lib/cn";
import { StatusPill } from "@/components/ui/kit";

interface Stage {
  n: string;
  name: string;
  line: string;
  tone: "bone" | "ink" | "lilac" | "mint" | "signal";
  visual: ReactNode;
}

const STAGES: Stage[] = [
  {
    n: "01",
    name: "Collect",
    line: "Scan the code where it happened. No account, no app. You get a tracking code.",
    tone: "bone",
    visual: <QrVisual />,
  },
  {
    n: "02",
    name: "Understand",
    line: "Each sentence is split into aspects, each with its own sentiment, urgency and the exact words behind it.",
    tone: "ink",
    visual: (
      <p className="text-[1.35rem] leading-snug text-bone/60">
        “<mark className="rounded bg-mint/25 px-1 text-bone">Mess food is good</mark> but{" "}
        <mark className="rounded bg-signal/30 px-1 text-bone">Wi-Fi in Block 3 has been dead for 3 days</mark>”
      </p>
    ),
  },
  {
    n: "03",
    name: "Cluster",
    line: "Thirty-four people saying the same thing become one issue, not thirty-four tickets.",
    tone: "lilac",
    visual: <ClusterVisual />,
  },
  {
    n: "04",
    name: "Prioritize",
    line: "A score anyone can read: recent reports × share negative × urgency. No black box.",
    tone: "bone",
    visual: (
      <div className="font-mono text-sm">
        {[
          ["Reports, last 7 days", "31.5", 0.82],
          ["Negative share", "0.97", 0.97],
          ["Urgency", "× 3", 1],
        ].map(([k, v, w]) => (
          <div key={k as string} className="mb-3">
            <div className="mb-1 flex justify-between text-ink/60">
              <span>{k}</span>
              <span className="text-ink">{v}</span>
            </div>
            <div className="h-2 rounded-full bg-ink/10">
              <div className="loop-bar h-2 origin-left rounded-full bg-cobalt" style={{ width: `${(w as number) * 100}%` }} />
            </div>
          </div>
        ))}
        <p className="mt-4 text-2xl text-ink">
          = 91.7 <span className="text-sm text-ink/50">priority #1</span>
        </p>
      </div>
    ),
  },
  {
    n: "05",
    name: "Act",
    line: "The right team gets it, moves it forward, and answers in public, not in a private inbox.",
    tone: "ink",
    visual: (
      <div className="flex flex-col gap-3">
        <div className="flex flex-wrap gap-2">
          <StatusPill status="open" />
          <StatusPill status="acknowledged" />
          <StatusPill status="in_progress" />
          <StatusPill status="resolved" />
        </div>
        <p className="rounded-2xl bg-bone/[0.06] p-4 text-sm leading-relaxed text-bone/75 ring-1 ring-bone/10">
          <span className="eyebrow mb-2 block text-lilac">IT services replied</span>
          New access point installed on floors 2–4. Speeds are back above 80 Mbps.
        </p>
      </div>
    ),
  },
  {
    n: "06",
    name: "Verify",
    line: "The people who reported it decide if it's fixed. If 30% say no, it reopens by itself.",
    tone: "signal",
    visual: (
      <div>
        <p className="display-soft mb-4 text-3xl">Was it actually fixed?</p>
        <div className="grid grid-cols-2 gap-2">
          <span className="rounded-2xl bg-ink px-4 py-3 text-center text-bone">Yes · 4</span>
          <span className="rounded-2xl bg-ink/10 px-4 py-3 text-center ring-2 ring-ink">Not fixed · 3</span>
        </div>
        <p className="eyebrow mt-4 text-ink/70">43% said no → reopened</p>
      </div>
    ),
  },
  {
    n: "07",
    name: "Show",
    line: "A public page with every issue, every answer and how many were verified fixed. Check it yourself.",
    tone: "mint",
    visual: (
      <div>
        <p className="display text-[5.5rem] leading-none">80%</p>
        <p className="mt-2 text-ink/70">of resolved issues verified fixed by the people who reported them</p>
      </div>
    ),
  },
];

const TONE: Record<Stage["tone"], string> = {
  bone: "bg-bone text-ink",
  ink: "bg-ink text-bone",
  lilac: "bg-lilac text-ink",
  mint: "bg-mint text-ink",
  signal: "bg-signal text-ink",
};

export function Loop() {
  const ref = useRef<HTMLElement>(null);
  const track = useRef<HTMLDivElement>(null);

  useGSAP(
    () => {
      if (prefersReducedMotion()) return;
      const mm = gsap.matchMedia();
      mm.add("(min-width: 900px)", () => {
        const el = track.current!;
        const distance = () => el.scrollWidth - window.innerWidth + 48;
        const scroller = gsap.to(el, {
          x: () => -distance(),
          ease: "none",
          scrollTrigger: {
            trigger: ref.current,
            start: "top top",
            end: () => `+=${distance()}`,
            pin: true,
            scrub: 0.8,
            invalidateOnRefresh: true,
          },
        });
        // Cards tilt in as they cross the viewport
        gsap.utils.toArray<HTMLElement>(".loop-card").forEach((card) => {
          gsap.from(card, {
            rotate: 4,
            yPercent: 8,
            ease: "none",
            scrollTrigger: { trigger: card, containerAnimation: scroller, start: "left right", end: "left 55%", scrub: true },
          });
        });
        gsap.to(".loop-progress", {
          scaleX: 1,
          ease: "none",
          scrollTrigger: { trigger: ref.current, start: "top top", end: () => `+=${distance()}`, scrub: true },
        });
      });
      mm.add("(max-width: 899px)", () => {
        gsap.utils.toArray<HTMLElement>(".loop-card").forEach((card) =>
          gsap.from(card, { y: 60, opacity: 0, scrollTrigger: { trigger: card, start: "top 88%" } }),
        );
      });
      gsap.from(".loop-bar", { scaleX: 0, stagger: 0.15, duration: 1.4, scrollTrigger: { trigger: ref.current, start: "top 40%" } });
      ScrollTrigger.refresh();
    },
    { scope: ref },
  );

  return (
    <section id="loop" ref={ref} className="relative overflow-hidden bg-cobalt text-bone">
      <div className="flex min-h-[100svh] flex-col justify-center py-24 md:py-0">
        <div className="mx-auto mb-12 flex w-full max-w-[88rem] items-end justify-between gap-6 px-5 sm:px-8">
          <div>
            <p className="eyebrow mb-5 text-lilac">02 · How it works</p>
            <h2 className="display text-[clamp(3rem,7.5vw,7.5rem)]">
              Seven steps.
              <br />
              <span className="serif-accent text-lilac">One loop.</span>
            </h2>
          </div>
          <div className="hidden w-56 md:block">
            <p className="eyebrow mb-3 text-bone/60">Scroll to follow a complaint</p>
            <div className="h-[3px] rounded-full bg-bone/20">
              <div className="loop-progress h-full origin-left scale-x-0 rounded-full bg-bone" />
            </div>
          </div>
        </div>

        <div ref={track} className="flex flex-col gap-4 px-5 sm:px-8 md:w-max md:flex-row md:gap-5">
          {STAGES.map((s) => (
            <article
              key={s.n}
              className={cn(
                "loop-card flex flex-col justify-between rounded-[2rem] p-7 md:h-[min(62vh,34rem)] md:w-[26rem] md:p-8",
                TONE[s.tone],
              )}
            >
              <div>
                <div className="mb-6 flex items-baseline justify-between">
                  <span className="font-mono text-sm opacity-50">{s.n} / 07</span>
                </div>
                <h3 className="display mb-4 text-[3.4rem]">{s.name}</h3>
                <p className="max-w-[22rem] text-[1.02rem] leading-relaxed opacity-75">{s.line}</p>
              </div>
              <div className="mt-8">{s.visual}</div>
            </article>
          ))}
          <div className="hidden w-[12vw] shrink-0 md:block" />
        </div>
      </div>
    </section>
  );
}

/* A QR-ish pattern with the location printed under it */
function QrVisual() {
  const cells = Array.from({ length: 121 }, (_, i) => {
    const x = i % 11;
    const y = Math.floor(i / 11);
    const finder = (x < 3 && y < 3) || (x > 7 && y < 3) || (x < 3 && y > 7);
    if (finder) return 1;
    return (x * 7 + y * 13 + x * y) % 3 === 0 ? 1 : 0;
  });
  return (
    <div className="flex items-end gap-5">
      <div className="grid w-32 grid-cols-11 gap-[2px] rounded-xl bg-white p-2.5">
        {cells.map((c, i) => (
          <span key={i} className={cn("aspect-square rounded-[1px]", c ? "bg-ink" : "bg-transparent")} />
        ))}
      </div>
      <div className="pb-1">
        <p className="eyebrow text-ink/50">You're at</p>
        <p className="display-soft text-2xl">Hostel Block 3</p>
      </div>
    </div>
  );
}

function ClusterVisual() {
  const ref = useRef<HTMLDivElement>(null);
  useGSAP(
    () => {
      if (prefersReducedMotion()) return;
      const dots = gsap.utils.toArray<HTMLElement>(".cl-dot");
      const tl = gsap.timeline({ repeat: -1, repeatDelay: 0.8, scrollTrigger: { trigger: ref.current, start: "top bottom", toggleActions: "play pause resume pause" } });
      tl.fromTo(
        dots,
        { x: () => gsap.utils.random(-110, 110), y: () => gsap.utils.random(-50, 50), opacity: 0.35 },
        { x: 0, y: 0, opacity: 1, duration: 1.6, stagger: 0.03, ease: "power3.inOut" },
      )
        .to(".cl-count", { scale: 1.15, duration: 0.25, yoyo: true, repeat: 1 }, "-=0.2")
        .to(dots, { opacity: 0.35, duration: 0.6 }, "+=1.2");
    },
    { scope: ref },
  );
  return (
    <div ref={ref} className="relative grid h-32 place-items-center">
      {Array.from({ length: 18 }).map((_, i) => (
        <span key={i} className="cl-dot absolute h-3 w-3 rounded-full bg-cobalt" style={{ marginLeft: (i % 6) * 5 - 12, marginTop: Math.floor(i / 6) * 5 - 5 }} />
      ))}
      <span className="cl-count absolute -right-1 top-0 rounded-full bg-ink px-3 py-1 font-mono text-xs text-bone">34 reports → 1 issue</span>
    </div>
  );
}
