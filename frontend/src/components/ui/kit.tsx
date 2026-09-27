import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from "react";
import { Link, type LinkProps } from "react-router-dom";
import { cn } from "@/lib/cn";
import { SENTIMENT_LABEL, STATUS_LABEL, URGENCY_LABEL } from "@/lib/format";
import type { IssueStatus, Sentiment, Urgency } from "@/lib/types";

/* ---------- Logo ---------------------------------------------------------- */

export function LogoMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 40 40" className={cn("group/logo", className)} aria-hidden>
      <circle cx="13" cy="20" r="5" fill="currentColor" />
      <path
        d="M21 11.5a12 12 0 0 1 0 17"
        stroke="currentColor"
        strokeWidth="3.4"
        strokeLinecap="round"
        fill="none"
        className="origin-[13px_20px] transition-transform duration-500 ease-[var(--ease-out-expo)] group-hover/logo:scale-110"
      />
      <path
        d="M27 5.5a20 20 0 0 1 0 29"
        stroke="currentColor"
        strokeWidth="3.4"
        strokeLinecap="round"
        fill="none"
        opacity=".5"
        className="origin-[13px_20px] transition-transform delay-75 duration-500 ease-[var(--ease-out-expo)] group-hover/logo:scale-115"
      />
    </svg>
  );
}

export function Logo({ className }: { className?: string }) {
  return (
    <Link to="/" className={cn("group/logo inline-flex items-center gap-1.5", className)} aria-label="Echo home">
      <LogoMark className="h-7 w-7" />
      <span className="display-soft text-[1.55rem] leading-none tracking-[-0.04em]">echo</span>
    </Link>
  );
}

/* ---------- Buttons ------------------------------------------------------- */

type Variant = "bone" | "ink" | "cobalt" | "ghost" | "ghost-dark" | "signal" | "mint";
const VARIANT: Record<Variant, string> = {
  bone: "bg-bone text-ink hover:bg-white",
  ink: "bg-ink text-bone hover:bg-ink-3",
  cobalt: "bg-cobalt text-bone hover:bg-cobalt-deep",
  ghost: "text-bone ring-1 ring-inset ring-bone/25 hover:ring-bone/60 hover:bg-bone/5",
  "ghost-dark": "text-ink ring-1 ring-inset ring-ink/20 hover:ring-ink/50 hover:bg-ink/5",
  signal: "bg-signal text-ink hover:brightness-110",
  mint: "bg-mint text-ink hover:brightness-105",
};
const SIZE = {
  sm: "h-9 px-4 text-sm",
  md: "h-12 px-6 text-[0.95rem]",
  lg: "h-15 px-8 text-lg",
};

const base =
  "relative inline-flex items-center justify-center gap-2 overflow-hidden rounded-full font-medium tracking-[-0.01em] transition-[background,box-shadow,filter,transform] duration-300 active:scale-[0.97] disabled:pointer-events-none disabled:opacity-50 select-none";

/** Label slides up and is replaced by a copy of itself on hover. */
function RollLabel({ children }: { children: ReactNode }) {
  return (
    <span className="relative inline-flex overflow-hidden">
      <span className="transition-transform duration-500 ease-[var(--ease-out-expo)] group-hover/btn:-translate-y-full">{children}</span>
      <span aria-hidden className="absolute inset-0 translate-y-full transition-transform duration-500 ease-[var(--ease-out-expo)] group-hover/btn:translate-y-0">
        {children}
      </span>
    </span>
  );
}

type BtnProps = ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; size?: keyof typeof SIZE; icon?: ReactNode };

export const Button = forwardRef<HTMLButtonElement, BtnProps>(function Button(
  { variant = "bone", size = "md", className, children, icon, ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      aria-label={typeof children === "string" ? children : undefined}
      className={cn(base, "group/btn", VARIANT[variant], SIZE[size], className)}
      {...rest}
    >
      <RollLabel>{children}</RollLabel>
      {icon}
    </button>
  );
});

export function ButtonLink({
  variant = "bone",
  size = "md",
  className,
  children,
  icon,
  ...rest
}: LinkProps & { variant?: Variant; size?: keyof typeof SIZE; icon?: ReactNode }) {
  return (
    <Link
      aria-label={typeof children === "string" ? children : undefined}
      className={cn(base, "group/btn", VARIANT[variant], SIZE[size], className)}
      {...rest}
    >
      <RollLabel>{children}</RollLabel>
      {icon}
    </Link>
  );
}

export function Arrow({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 20 20" className={cn("h-4 w-4 transition-transform duration-500 ease-[var(--ease-out-expo)] group-hover/btn:translate-x-1", className)} aria-hidden>
      <path d="M3 10h13M11 4.5 16.5 10 11 15.5" stroke="currentColor" strokeWidth="1.8" fill="none" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/* ---------- Status & sentiment ------------------------------------------ */

const STATUS_STYLE: Record<IssueStatus, string> = {
  open: "bg-signal/12 text-signal ring-signal/35",
  acknowledged: "bg-amber/15 text-amber ring-amber/35",
  in_progress: "bg-lilac/15 text-lilac ring-lilac/35",
  resolved: "bg-mint/15 text-mint ring-mint/35",
  reopened: "bg-signal text-ink ring-signal",
};
const STATUS_STYLE_LIGHT: Record<IssueStatus, string> = {
  open: "bg-signal/10 text-[#c53d0c] ring-signal/40",
  acknowledged: "bg-amber/25 text-[#7a5200] ring-amber/60",
  in_progress: "bg-cobalt/10 text-cobalt ring-cobalt/30",
  resolved: "bg-mint/40 text-mint-deep ring-mint-deep/25",
  reopened: "bg-signal text-ink ring-signal",
};

export function StatusPill({ status, light = false, className }: { status: IssueStatus; light?: boolean; className?: string }) {
  return (
    <span
      className={cn(
        "inline-flex h-6 items-center gap-1.5 rounded-full px-2.5 text-[0.7rem] font-medium uppercase tracking-[0.08em] ring-1 ring-inset",
        (light ? STATUS_STYLE_LIGHT : STATUS_STYLE)[status],
        className,
      )}
    >
      <span className={cn("h-1.5 w-1.5 rounded-full bg-current", status !== "resolved" && "animate-pulse")} />
      {STATUS_LABEL[status]}
    </span>
  );
}

const SENTIMENT_DOT: Record<Sentiment, string> = {
  positive: "bg-mint",
  neutral: "bg-bone-3",
  negative: "bg-signal",
};

export function SentimentChip({ sentiment, className }: { sentiment: Sentiment; className?: string }) {
  return (
    <span className={cn("inline-flex items-center gap-1.5 text-xs font-medium", className)}>
      <span className={cn("h-2 w-2 rounded-full", SENTIMENT_DOT[sentiment])} />
      {SENTIMENT_LABEL[sentiment]}
    </span>
  );
}

export function UrgencyTag({ urgency, className }: { urgency: Urgency; className?: string }) {
  if (urgency === "normal") return null;
  return (
    <span
      className={cn(
        "eyebrow inline-flex h-5 items-center rounded px-1.5 !text-[0.62rem]",
        urgency === "critical" ? "bg-signal text-ink" : "bg-signal/15 text-signal",
        className,
      )}
    >
      {URGENCY_LABEL[urgency]}
    </span>
  );
}

/* ---------- States ------------------------------------------------------- */

export function Spinner({ className }: { className?: string }) {
  // Three bars, like a voice meter
  return (
    <span className={cn("inline-flex h-4 items-end gap-[3px]", className)} role="status" aria-label="Loading">
      {[0, 1, 2].map((i) => (
        <span
          key={i}
          className="w-[3px] rounded-full bg-current"
          style={{ height: "100%", animation: `echo-bar 0.9s ${i * 0.15}s ease-in-out infinite` }}
        />
      ))}
      <style>{`@keyframes echo-bar{0%,100%{transform:scaleY(.3)}50%{transform:scaleY(1)}}`}</style>
    </span>
  );
}

export function ErrorNote({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <p role="alert" className={cn("flex items-start gap-2 rounded-2xl bg-signal/12 px-4 py-3 text-sm text-signal", className)}>
      <span aria-hidden className="mt-0.5 font-mono">!</span>
      <span>{children}</span>
    </p>
  );
}
