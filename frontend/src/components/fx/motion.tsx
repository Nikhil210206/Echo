import { useRef, type ElementType, type ReactNode, type ComponentPropsWithoutRef } from "react";
import { gsap, ScrollTrigger, SplitText, useGSAP, prefersReducedMotion } from "@/lib/gsap";
import { cn } from "@/lib/cn";

type Polymorphic<T extends ElementType> = { as?: T; className?: string; children?: ReactNode } & Omit<
  ComponentPropsWithoutRef<T>,
  "as" | "className" | "children"
>;

/**
 * Lines rise out of a mask. Plays on mount, or when scrolled into view with `inView`.
 * SplitText's autoSplit re-splits after fonts load or the viewport resizes.
 */
export function SplitReveal<T extends ElementType = "h2">({
  as,
  className,
  children,
  delay = 0,
  inView = false,
  stagger = 0.09,
  by = "lines",
  ...rest
}: Polymorphic<T> & { delay?: number; inView?: boolean; stagger?: number; by?: "lines" | "words" | "chars" }) {
  const Tag = (as ?? "h2") as ElementType;
  const ref = useRef<HTMLElement>(null);
  useGSAP(
    () => {
      if (!ref.current || prefersReducedMotion()) return;
      SplitText.create(ref.current, {
        type: by === "chars" ? "lines,chars" : by === "words" ? "lines,words" : "lines",
        mask: "lines",
        linesClass: "split-mask",
        autoSplit: true,
        onSplit(self) {
          const targets = by === "chars" ? self.chars : by === "words" ? self.words : self.lines;
          return gsap.from(targets, {
            yPercent: 115,
            rotate: by === "lines" ? 2.5 : 0,
            transformOrigin: "0% 100%",
            duration: 1.25,
            stagger,
            delay,
            scrollTrigger: inView ? { trigger: ref.current, start: "top 85%", once: true } : undefined,
          });
        },
      });
    },
    { scope: ref },
  );
  return (
    <Tag ref={ref} className={className} {...rest}>
      {children}
    </Tag>
  );
}

/** Words brighten one by one as the paragraph scrolls through the viewport. */
export function ScrubText({ className, children, dim = 0.14 }: { className?: string; children: ReactNode; dim?: number }) {
  const ref = useRef<HTMLParagraphElement>(null);
  useGSAP(
    () => {
      if (!ref.current || prefersReducedMotion()) return;
      const split = SplitText.create(ref.current, { type: "words" });
      gsap.fromTo(
        split.words,
        { opacity: dim },
        {
          opacity: 1,
          ease: "none",
          stagger: 0.1,
          scrollTrigger: { trigger: ref.current, start: "top 78%", end: "bottom 42%", scrub: 0.6 },
        },
      );
    },
    { scope: ref },
  );
  return (
    <p ref={ref} className={className}>
      {children}
    </p>
  );
}

/** Counts up to `value` when it enters the viewport. */
export function Counter({
  value,
  decimals = 0,
  suffix = "",
  prefix = "",
  className,
  duration = 2,
}: {
  value: number;
  decimals?: number;
  suffix?: string;
  prefix?: string;
  className?: string;
  duration?: number;
}) {
  const ref = useRef<HTMLSpanElement>(null);
  const fmt = (n: number) => `${prefix}${n.toLocaleString("en-IN", { minimumFractionDigits: decimals, maximumFractionDigits: decimals })}${suffix}`;
  useGSAP(
    () => {
      const el = ref.current;
      if (!el) return;
      if (prefersReducedMotion()) {
        el.textContent = fmt(value);
        return;
      }
      const o = { n: 0 };
      gsap.to(o, {
        n: value,
        duration,
        ease: "power3.out",
        scrollTrigger: { trigger: el, start: "top 90%", once: true },
        onUpdate: () => {
          el.textContent = fmt(o.n);
        },
      });
    },
    { dependencies: [value], scope: ref },
  );
  return (
    <span ref={ref} className={cn("tabular", className)}>
      {fmt(0)}
    </span>
  );
}

/** Child drifts toward the cursor while hovered, then springs back. */
export function Magnetic({ children, strength = 0.35, className }: { children: ReactNode; strength?: number; className?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  useGSAP(
    (_, contextSafe) => {
      const el = ref.current;
      if (!el || prefersReducedMotion() || !contextSafe) return;
      const xTo = gsap.quickTo(el, "x", { duration: 0.8, ease: "elastic.out(1, 0.4)" });
      const yTo = gsap.quickTo(el, "y", { duration: 0.8, ease: "elastic.out(1, 0.4)" });
      const move = contextSafe((e: PointerEvent) => {
        const r = el.getBoundingClientRect();
        xTo((e.clientX - (r.left + r.width / 2)) * strength);
        yTo((e.clientY - (r.top + r.height / 2)) * strength);
      });
      const leave = contextSafe(() => {
        xTo(0);
        yTo(0);
      });
      el.addEventListener("pointermove", move);
      el.addEventListener("pointerleave", leave);
      return () => {
        el.removeEventListener("pointermove", move);
        el.removeEventListener("pointerleave", leave);
      };
    },
    { scope: ref },
  );
  return (
    <div ref={ref} className={cn("inline-block will-change-transform", className)}>
      {children}
    </div>
  );
}

/** Seamless horizontal loop. Children are rendered twice. */
export function Marquee({ children, speed = 60, className, reverse = false }: { children: ReactNode; speed?: number; className?: string; reverse?: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  useGSAP(
    () => {
      const track = ref.current?.firstElementChild as HTMLElement | null;
      if (!track || prefersReducedMotion()) return;
      const half = track.scrollWidth / 2;
      const tween = gsap.fromTo(
        track,
        { x: reverse ? -half : 0 },
        { x: reverse ? 0 : -half, duration: half / speed, ease: "none", repeat: -1 },
      );
      // Slow down on hover so people can read
      const el = ref.current!;
      const slow = () => gsap.to(tween, { timeScale: 0.2, duration: 0.6 });
      const fast = () => gsap.to(tween, { timeScale: 1, duration: 0.6 });
      el.addEventListener("pointerenter", slow);
      el.addEventListener("pointerleave", fast);
      return () => {
        el.removeEventListener("pointerenter", slow);
        el.removeEventListener("pointerleave", fast);
      };
    },
    { scope: ref },
  );
  return (
    <div ref={ref} className={cn("overflow-hidden", className)}>
      <div className="flex w-max">
        <div className="flex shrink-0">{children}</div>
        <div className="flex shrink-0" aria-hidden>
          {children}
        </div>
      </div>
    </div>
  );
}

export { ScrollTrigger };
