import { useRef } from "react";
import { Link } from "react-router-dom";
import { DitherField } from "@/components/fx/DitherField";
import { Magnetic } from "@/components/fx/motion";
import { Arrow, ButtonLink, Logo } from "@/components/ui/kit";
import { gsap, useGSAP, prefersReducedMotion } from "@/lib/gsap";

export function Closing() {
  const ref = useRef<HTMLElement>(null);

  useGSAP(
    () => {
      if (prefersReducedMotion()) {
        gsap.set(".cta-disc", { clipPath: "circle(150% at 50% 100%)" });
        return;
      }
      const tl = gsap.timeline({
        scrollTrigger: { trigger: ref.current, start: "top top", end: "+=110%", scrub: 0.9, pin: true },
      });
      tl.fromTo(".cta-disc", { clipPath: "circle(6% at 50% 108%)" }, { clipPath: "circle(150% at 50% 100%)", ease: "power2.in" })
        .from(".cta-title", { yPercent: 40, opacity: 0, ease: "power2.out" }, 0.25)
        .from(".cta-actions", { y: 40, opacity: 0, ease: "power2.out" }, 0.5);
    },
    { scope: ref },
  );

  return (
    <>
      <section ref={ref} className="relative h-[100svh] overflow-hidden bg-bone">
        <div className="cta-disc absolute inset-0 bg-cobalt [clip-path:circle(6%_at_50%_108%)]">
          <DitherField
            cell={7}
            palette={["#2a1dd9", "#5a4dff", "#9b91ff"]}
            sources={[{ x: 0.5, y: 1.1, strength: 1.3 }]}
            floor={0.25}
            glow={150}
          />
          <div className="relative z-10 flex h-full flex-col items-center justify-center px-5 text-center text-bone">
            <h2 className="cta-title display text-[clamp(3.6rem,11vw,11rem)]">
              Heard something?
              <br />
              <span className="serif-accent text-lilac">Say it.</span>
            </h2>
            <div className="cta-actions mt-12 flex flex-wrap justify-center gap-3">
              <Magnetic>
                <ButtonLink to="/report" size="lg" icon={<Arrow />}>
                  Report an issue
                </ButtonLink>
              </Magnetic>
              <ButtonLink to="/track" size="lg" variant="ghost">
                Track a report
              </ButtonLink>
            </div>
          </div>
        </div>
      </section>
      <footer className="bg-cobalt text-bone">
        <div className="mx-auto flex max-w-[88rem] flex-col gap-10 px-5 pb-10 pt-4 sm:px-8 md:flex-row md:items-end md:justify-between">
          <div>
            <Logo />
            <p className="mt-3 max-w-xs text-sm text-bone/60">Every voice gets an answer. Built for Vision2Web 2026, Problem Statement 2.</p>
          </div>
          <nav className="flex flex-wrap gap-x-8 gap-y-2 text-sm text-bone/70">
            <Link to="/transparency" className="hover:text-bone">What got fixed</Link>
            <Link to="/track" className="hover:text-bone">Track a report</Link>
            <Link to="/report" className="hover:text-bone">Report an issue</Link>
            <Link to="/admin" className="hover:text-bone">Staff login</Link>
          </nav>
        </div>
      </footer>
    </>
  );
}
