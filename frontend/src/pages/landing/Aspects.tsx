import { useRef } from "react";
import { SplitReveal } from "@/components/fx/motion";
import { SentimentChip, UrgencyTag } from "@/components/ui/kit";
import { gsap, useGSAP, prefersReducedMotion } from "@/lib/gsap";

export function Aspects() {
  const ref = useRef<HTMLElement>(null);

  useGSAP(
    () => {
      if (prefersReducedMotion()) return;
      const tl = gsap.timeline({
        scrollTrigger: { trigger: ".asp-sentence", start: "top 75%", toggleActions: "play none none reverse" },
      });
      tl.from(".asp-word", { opacity: 0.12, stagger: 0.018, duration: 0.4, ease: "power2.out" })
        .to(".asp-hl-pos", { backgroundSize: "100% 100%", duration: 0.6, ease: "power2.inOut" }, "-=0.1")
        .to(".asp-hl-neg", { backgroundSize: "100% 100%", duration: 0.9, ease: "power2.inOut" }, "-=0.2")
        .from(".asp-card", { y: 80, opacity: 0, rotate: (i) => (i ? 3 : -3), stagger: 0.12, duration: 0.9 }, "-=0.5")
        .from(".asp-link", { scaleY: 0, stagger: 0.15, duration: 0.6 }, "<")
        .to(".asp-strike", { scaleX: 1, duration: 0.7, ease: "power3.inOut" }, "-=0.3");
    },
    { scope: ref },
  );

  const words = (s: string) =>
    s.split(" ").map((w, i) => (
      <span key={i} className="asp-word">
        {w}{" "}
      </span>
    ));

  return (
    <section ref={ref} className="grain relative overflow-hidden bg-ink text-bone">
      <div className="mx-auto max-w-[88rem] px-5 py-28 sm:px-8 md:py-40">
        <div className="mb-16 flex flex-wrap items-end justify-between gap-6">
          <div>
            <p className="eyebrow mb-5 text-lilac">03 · Understand</p>
            <SplitReveal inView className="display text-[clamp(3rem,7vw,7rem)]">
              One sentence.
              <br />
              <span className="serif-accent text-lilac">Two truths.</span>
            </SplitReveal>
          </div>
          <p className="max-w-sm text-bone/60">
            A single sentiment label would call this sentence neutral. That's wrong twice. Echo keeps the praise and the complaint apart and
            shows you the words behind each one.
          </p>
        </div>

        <p className="asp-sentence display-soft relative text-[clamp(1.9rem,4.6vw,4.4rem)] leading-[1.12]">
          <span className="asp-hl asp-hl-pos rounded-lg px-1 [background-image:linear-gradient(rgba(143,240,174,.28),rgba(143,240,174,.28))] [background-repeat:no-repeat] [background-size:0%_100%]">
            {words("Mess food is good")}
          </span>
          {words("but")}
          <span className="asp-hl asp-hl-neg rounded-lg px-1 [background-image:linear-gradient(rgba(255,90,31,.38),rgba(255,90,31,.38))] [background-repeat:no-repeat] [background-size:0%_100%]">
            {words("the Wi-Fi in Block 3 has been dead for 3 days.")}
          </span>
        </p>

        <div className="mt-14 grid gap-4 md:grid-cols-[1fr_1.4fr_auto] md:items-start">
          <div className="asp-card relative rounded-[1.75rem] bg-mint p-6 text-ink">
            <span className="asp-link absolute -top-10 left-10 hidden h-10 w-px origin-bottom bg-mint md:block" />
            <div className="mb-8 flex items-center justify-between">
              <span className="eyebrow">Aspect · Food</span>
              <SentimentChip sentiment="positive" className="rounded-full bg-ink px-2.5 py-1 text-bone" />
            </div>
            <p className="serif-accent text-2xl">“Mess food is good”</p>
          </div>
          <div className="asp-card relative rounded-[1.75rem] bg-signal p-6 text-ink">
            <span className="asp-link absolute -top-10 left-10 hidden h-10 w-px origin-bottom bg-signal md:block" />
            <div className="mb-8 flex flex-wrap items-center justify-between gap-2">
              <span className="eyebrow">Aspect · Wi-Fi · Hostel Block 3</span>
              <span className="flex items-center gap-2">
                <UrgencyTag urgency="critical" className="!bg-ink !text-signal" />
                <SentimentChip sentiment="negative" className="rounded-full bg-ink px-2.5 py-1 text-bone" />
              </span>
            </div>
            <p className="serif-accent text-2xl">“the Wi-Fi in Block 3 has been dead for 3 days”</p>
            <p className="mt-4 font-mono text-xs text-ink/70">→ joined issue #1 · 34 reports</p>
          </div>
          <div className="asp-card flex h-full flex-col justify-center rounded-[1.75rem] p-6 ring-1 ring-bone/15">
            <span className="eyebrow mb-2 text-bone/40">One label would say</span>
            <span className="relative w-fit text-3xl text-bone/50">
              Neutral
              <span className="asp-strike absolute left-0 top-1/2 h-[3px] w-full origin-left scale-x-0 bg-signal" />
            </span>
          </div>
        </div>
      </div>
    </section>
  );
}
