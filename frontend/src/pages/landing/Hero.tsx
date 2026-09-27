import { useEffect, useRef, useState } from "react";
import { DitherField } from "@/components/fx/DitherField";
import { Magnetic, Marquee } from "@/components/fx/motion";
import { Arrow, ButtonLink } from "@/components/ui/kit";
import { gsap, SplitText, useGSAP, prefersReducedMotion } from "@/lib/gsap";
import { timeAgo } from "@/lib/format";
import { api } from "@/lib/api";
import type { TickerItem } from "@/lib/types";
import { cn } from "@/lib/cn";

export function Hero() {
  const ref = useRef<HTMLElement>(null);
  const [ticker, setTicker] = useState<TickerItem[]>([]);

  useEffect(() => {
    let alive = true;
    api
      .ticker()
      .then((t) => alive && setTicker(t))
      .catch(() => {}); // the hero works without it
    return () => {
      alive = false;
    };
  }, []);

  useGSAP(
    () => {
      if (prefersReducedMotion()) return;
      const tl = gsap.timeline({ delay: 0.15 });
      tl.from(".hero-field", { opacity: 0, duration: 2.4, ease: "power2.out" }, 0);
      SplitText.create(".hero-title", {
        type: "lines,chars",
        mask: "lines",
        linesClass: "split-mask",
        autoSplit: true,
        onSplit(self) {
          return gsap.from(self.chars, { yPercent: 120, duration: 1.3, stagger: 0.022, delay: 0.35 });
        },
      });
      tl.from(".hero-fade", { y: 24, opacity: 0, duration: 1.2, stagger: 0.1 }, 0.9);
      tl.from(".hero-ticker", { opacity: 0, y: 20, duration: 1 }, 1.3);

      // Headline drifts up and dims as you scroll away — the field stays
      gsap.to(".hero-copy", {
        yPercent: -18,
        opacity: 0.2,
        ease: "none",
        scrollTrigger: { trigger: ref.current, start: "top top", end: "bottom top", scrub: true },
      });
    },
    { scope: ref },
  );

  return (
    <section ref={ref} className="grain relative flex min-h-[100svh] flex-col overflow-hidden bg-ink">
      <DitherField
        className="hero-field"
        cell={6}
        palette={["#16104f", "#3b2bff", "#8a7fff", "#e4e0ff"]}
        sources={[
          { x: 0.84, y: 0.46, strength: 1.05 },
          { x: 0.1, y: 1.1, strength: 0.5 },
        ]}
        orbs={[{ x: 0.84, y: 0.46, r: 0.2 }]}
        floor={0.3}
        glow={130}
      />
      {/* keep the copy readable where it sits over the field */}
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(90%_70%_at_12%_85%,rgba(13,13,16,.92)_20%,rgba(13,13,16,0)_70%)]" />

      <div className="hero-copy relative z-10 mx-auto flex w-full max-w-[88rem] flex-1 flex-col justify-end px-5 pb-10 pt-32 sm:px-8 md:pb-14">
        <div className="hero-fade mb-8 inline-flex w-fit items-center gap-2.5 rounded-full bg-bone/[0.06] py-1.5 pl-2 pr-4 ring-1 ring-bone/10 backdrop-blur-md">
          <span className="relative flex h-2.5 w-2.5">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-mint opacity-60" />
            <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-mint" />
          </span>
          <span className="eyebrow text-bone/75">Campus feedback · closed loop</span>
        </div>

        <h1 className="hero-title display text-[clamp(3.6rem,12.5vw,13.5rem)] text-bone">
          Every voice
          <br />
          gets an <span className="serif-accent pr-[0.06em] text-lilac">answer.</span>
        </h1>

        <div className="mt-10 grid gap-8 md:mt-14 md:grid-cols-[1fr_auto] md:items-end">
          <p className="hero-fade max-w-[34rem] text-lg leading-relaxed text-bone/70 md:text-xl">
            Scan the code where it happened and say what's wrong. Echo turns it into an issue someone owns, answers you in public, and
            asks <em className="serif-accent text-[1.15em] text-bone not-italic">you</em> whether it actually got fixed.
          </p>
          <div className="hero-fade flex flex-wrap items-center gap-3">
            <Magnetic>
              <ButtonLink to="/report" size="lg" icon={<Arrow />}>
                Report an issue
              </ButtonLink>
            </Magnetic>
            <ButtonLink to="/transparency" size="lg" variant="ghost">
              See what got fixed
            </ButtonLink>
          </div>
        </div>
        <p className="hero-fade eyebrow mt-8 hidden text-bone/35 md:block">↳ move your cursor. every voice makes a wave.</p>
      </div>

      {/* Kept mounted while quotes load so the intro animation always has its target */}
      <div className={cn("hero-ticker relative z-10 min-h-[2.9rem] border-t border-bone/10 bg-ink/40 backdrop-blur-sm", ticker.length === 0 && "invisible")}>
        {/* Marquee measures its content once on mount, so it mounts only after the quotes arrive */}
        {ticker.length > 0 && (
          <Marquee speed={45} className="py-3.5">
            {ticker.map((t, i) => (
              <span key={i} className="flex items-center gap-3 pr-12 font-mono text-[0.78rem] text-bone/60">
                <span className={cn("h-1.5 w-1.5 rounded-full", t.sentiment === "negative" ? "bg-signal" : "bg-mint")} />
                <span className="text-bone/85">“{t.text}”</span>
                <span className="text-bone/35">{timeAgo(t.at)}</span>
              </span>
            ))}
          </Marquee>
        )}
      </div>
    </section>
  );
}
