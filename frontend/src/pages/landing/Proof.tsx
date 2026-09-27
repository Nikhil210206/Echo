import { useEffect, useRef, useState } from "react";
import { Counter, SplitReveal } from "@/components/fx/motion";
import { gsap, useGSAP, prefersReducedMotion } from "@/lib/gsap";
import { api } from "@/lib/api";
import type { PublicStats } from "@/lib/types";
import { cn } from "@/lib/cn";

const STEPS = ["Open", "Acknowledged", "In progress", "Resolved"];

export function Proof() {
  const ref = useRef<HTMLElement>(null);
  const [stats, setStats] = useState<PublicStats | null>(null);

  useEffect(() => {
    let alive = true;
    api
      .publicStats()
      .then((s) => alive && setStats(s))
      .catch(() => alive && setStats(null));
    return () => {
      alive = false;
    };
  }, []);

  useGSAP(
    () => {
      if (prefersReducedMotion()) return;
      const nodes = gsap.utils.toArray<HTMLElement>(".lc-node");
      const marker = ".lc-marker";
      const pos = (i: number) => nodes[i].offsetLeft + nodes[i].offsetWidth / 2 - 10;
      const tl = gsap.timeline({
        repeat: -1,
        repeatDelay: 1,
        scrollTrigger: { trigger: ".lc", start: "top 85%", toggleActions: "play pause resume pause" },
      });
      tl.set(marker, { x: () => pos(0), y: 0 })
        .set(".lc-reopen", { opacity: 0.25, scale: 0.9 })
        .set(".lc-vote", { opacity: 0, y: 10 });
      [1, 2, 3].forEach((i) => {
        tl.to(marker, { x: () => pos(i), duration: 0.9, ease: "power3.inOut" }).to(nodes[i], { scale: 1.08, duration: 0.2, yoyo: true, repeat: 1 });
      });
      tl.to(".lc-vote", { opacity: 1, y: 0, stagger: 0.18, duration: 0.4 }, "+=0.3")
        .to(".lc-reopen", { opacity: 1, scale: 1, duration: 0.5, ease: "back.out(2)" }, "+=0.2")
        .to(marker, { y: 74, duration: 0.5, ease: "power2.in" }, "<")
        .to(marker, { x: () => pos(2), duration: 0.9, ease: "power3.inOut" }, "+=0.4")
        .to(marker, { y: 0, duration: 0.5, ease: "power2.out" });
    },
    { scope: ref, dependencies: [!!stats] },
  );

  const figures = stats
    ? [
        { v: stats.people_heard, d: 0, s: "", label: "people heard" },
        { v: stats.response_rate * 100, d: 0, s: "%", label: "of issues got a public answer" },
        { v: stats.avg_days_to_resolve, d: 1, s: "", label: "days on average to fix" },
        { v: stats.verified_fix_rate * 100, d: 0, s: "%", label: "verified fixed by the people who reported them" },
      ]
    : [];

  return (
    <section ref={ref} className="relative bg-bone text-ink">
      <div className="mx-auto max-w-[88rem] px-5 py-28 sm:px-8 md:py-40">
        <p className="eyebrow mb-6 text-ink/50">04 · Verify</p>
        <SplitReveal inView className="display max-w-5xl text-[clamp(3rem,7vw,7rem)]">
          Resolved isn't the end. <span className="serif-accent text-cobalt">You are.</span>
        </SplitReveal>

        <div className="mt-20 grid grid-cols-2 gap-x-6 gap-y-12 border-t border-ink/15 pt-10 lg:grid-cols-4">
          {figures.map((f) => (
            <div key={f.label}>
              <p className="display text-[clamp(3.2rem,6vw,6rem)] leading-none">
                <Counter value={f.v} decimals={f.d} suffix={f.s} />
              </p>
              <p className="mt-3 max-w-[14rem] text-ink/60">{f.label}</p>
            </div>
          ))}
          {!stats && <p className="col-span-full h-28 animate-pulse rounded-3xl bg-ink/5" />}
        </div>

        {/* Lifecycle, animated: an issue resolves, reporters disagree, it reopens */}
        <div className="lc mt-24 overflow-x-auto rounded-[2rem] bg-ink p-6 text-bone no-scrollbar sm:p-10">
          <div className="relative min-w-[40rem] pb-24">
            <div className="absolute left-8 right-8 top-[1.4rem] h-px bg-bone/15" />
            <div className="relative flex justify-between">
              {STEPS.map((s, i) => (
                <div key={s} className={cn("lc-node relative z-10 rounded-full px-4 py-2.5 text-sm ring-1", i === 3 ? "bg-mint text-ink ring-mint" : "bg-ink-2 ring-bone/15")}>
                  {s}
                </div>
              ))}
            </div>
            <span className="lc-marker absolute left-0 top-[0.75rem] z-20 h-5 w-5 rounded-full bg-lilac shadow-[0_0_24px_6px_rgba(201,194,255,.45)]" />
            <div className="absolute bottom-0 right-0 flex items-center gap-3">
              <div className="flex gap-1.5">
                {["✓", "✓", "✗", "✓", "✗"].map((v, i) => (
                  <span key={i} className={cn("lc-vote grid h-8 w-8 place-items-center rounded-full font-mono text-sm", v === "✗" ? "bg-signal text-ink" : "bg-bone/10")}>
                    {v}
                  </span>
                ))}
              </div>
              <span className="lc-reopen rounded-full bg-signal px-4 py-2.5 text-sm font-medium text-ink">Reopened · 40% said not fixed</span>
            </div>
            <p className="absolute bottom-2 left-0 max-w-xs text-sm text-bone/50">
              Only people who reported it can vote. One vote each. 30% “not fixed” with at least 3 votes sends it back.
            </p>
          </div>
        </div>
      </div>
    </section>
  );
}
