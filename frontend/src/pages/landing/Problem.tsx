import { useRef } from "react";
import { ScrubText, SplitReveal } from "@/components/fx/motion";
import { gsap, useGSAP, prefersReducedMotion } from "@/lib/gsap";

export function Problem() {
  const ref = useRef<HTMLElement>(null);
  useGSAP(
    () => {
      if (prefersReducedMotion()) return;
      gsap.from(".void-ring", {
        scale: 0.4,
        opacity: 0,
        stagger: 0.12,
        duration: 1.6,
        scrollTrigger: { trigger: ".void", start: "top 80%" },
      });
      // The black hole slowly swallows the rings
      gsap.to(".void-ring", {
        scale: 0.15,
        opacity: 0,
        stagger: 0.08,
        ease: "power1.in",
        scrollTrigger: { trigger: ref.current, start: "40% center", end: "bottom top", scrub: 0.8 },
      });
    },
    { scope: ref },
  );

  return (
    <section ref={ref} className="relative overflow-hidden bg-bone text-ink">
      <div className="mx-auto grid max-w-[88rem] gap-14 px-5 py-28 sm:px-8 md:grid-cols-[1.35fr_1fr] md:py-44">
        <div>
          <p className="eyebrow mb-10 text-ink/50">01 · The problem</p>
          <ScrubText className="display-soft text-[clamp(2rem,4.3vw,4.1rem)] leading-[1.06]">
            Every campus has a feedback form. You fill it in, you press submit, and then nothing. No reply, no fix, no sign anyone read it.
            So next time, you don't bother.
          </ScrubText>
          <SplitReveal as="p" inView className="mt-14 text-[clamp(1.8rem,3.4vw,3.2rem)] leading-[1.05] tracking-[-0.02em]">
            <span className="serif-accent text-cobalt">Echo closes the loop,</span> and proves it.
          </SplitReveal>
        </div>

        {/* A feedback black hole: messages fall in, nothing comes out */}
        <div className="void relative mx-auto aspect-square w-full max-w-[26rem] self-center">
          {[1, 0.8, 0.62, 0.46, 0.32].map((s, i) => (
            <div
              key={i}
              className="void-ring absolute inset-0 m-auto rounded-full border border-ink/15"
              style={{ width: `${s * 100}%`, height: `${s * 100}%` }}
            />
          ))}
          <div className="absolute inset-0 m-auto h-[22%] w-[22%] rounded-full bg-ink shadow-[0_0_80px_30px_rgba(13,13,16,.25)]" />
          {["“Wi-Fi is down”", "“Fix the AC”", "“Bus is late”"].map((t, i) => (
            <span
              key={t}
              className="absolute left-1/2 top-1/2 whitespace-nowrap rounded-full bg-white px-3 py-1.5 font-mono text-xs text-ink/70 shadow-sm"
              style={{
                animation: `fall-in 6s ${i * 2}s cubic-bezier(.55,0,.8,.2) infinite`,
                ["--a" as string]: `${i * 120 + 20}deg`,
              }}
            >
              {t}
            </span>
          ))}
          <style>{`@keyframes fall-in{0%{transform:translate(-50%,-50%) rotate(var(--a)) translateX(13rem) rotate(calc(var(--a) * -1)) scale(1);opacity:0}12%{opacity:1}100%{transform:translate(-50%,-50%) rotate(calc(var(--a) + 200deg)) translateX(0) rotate(calc((var(--a) + 200deg) * -1)) scale(.2);opacity:0}}`}</style>
          <p className="eyebrow absolute -bottom-2 left-0 right-0 text-center text-ink/40">where feedback usually goes</p>
        </div>
      </div>
    </section>
  );
}
