import { useRef, useState } from "react";
import { NavLink } from "react-router-dom";
import { gsap, useGSAP, ScrollTrigger } from "@/lib/gsap";
import { cn } from "@/lib/cn";
import { ButtonLink, Logo } from "@/components/ui/kit";

const LINKS = [
  { to: "/#loop", label: "How it works" },
  { to: "/transparency", label: "What got fixed" },
  { to: "/track", label: "Track a report" },
];

/**
 * Floating nav. Hides on scroll down, returns on scroll up, and switches to a
 * frosted pill once the page has moved. `tone` picks colours for the hero behind it.
 */
export function PublicNav({ tone = "dark", intro = true }: { tone?: "dark" | "light"; intro?: boolean }) {
  const ref = useRef<HTMLElement>(null);
  const [scrolled, setScrolled] = useState(false);
  const [open, setOpen] = useState(false);

  useGSAP(
    () => {
      const el = ref.current!;
      if (intro) gsap.from(el, { yPercent: -120, duration: 1.2, delay: 0.25 });
      const show = gsap.to(el, { yPercent: -130, duration: 0.5, ease: "power2.inOut", paused: true });
      ScrollTrigger.create({
        start: 0,
        end: "max",
        onUpdate(self) {
          setScrolled(self.scroll() > 40);
          if (self.scroll() < 120) show.reverse();
          else if (self.direction === 1) show.play();
          else show.reverse();
        },
      });
    },
    { scope: ref },
  );

  const dark = tone === "dark";
  return (
    <header ref={ref} className="fixed inset-x-0 top-0 z-50 px-3 pt-3 sm:px-5 sm:pt-4">
      <nav
        className={cn(
          "mx-auto flex h-14 max-w-[88rem] items-center justify-between rounded-full pl-5 pr-2 transition-[background,box-shadow,backdrop-filter] duration-500",
          dark ? "text-bone" : "text-ink",
          scrolled && (dark ? "bg-ink/70 shadow-[0_8px_40px_-12px_rgba(0,0,0,.6)] backdrop-blur-xl ring-1 ring-bone/10" : "bg-bone/75 backdrop-blur-xl ring-1 ring-ink/10"),
        )}
      >
        <Logo />
        <ul className="hidden items-center gap-1 md:flex">
          {LINKS.map((l) => (
            <li key={l.to}>
              <NavLink
                to={l.to}
                className={({ isActive }) =>
                  cn(
                    "rounded-full px-4 py-2 text-sm transition-colors",
                    dark ? "text-bone/70 hover:text-bone" : "text-ink/65 hover:text-ink",
                    isActive && !l.to.includes("#") && (dark ? "text-bone" : "text-ink"),
                  )
                }
              >
                {l.label}
              </NavLink>
            </li>
          ))}
        </ul>
        <div className="flex items-center gap-2">
          <NavLink to="/admin" className={cn("hidden px-3 text-sm sm:block", dark ? "text-bone/60 hover:text-bone" : "text-ink/60 hover:text-ink")}>
            Staff
          </NavLink>
          <ButtonLink to="/report" size="sm" variant={dark ? "bone" : "ink"} className="h-10 px-5">
            Report an issue
          </ButtonLink>
          <button
            type="button"
            className={cn("grid h-10 w-10 place-items-center rounded-full md:hidden", dark ? "bg-bone/10" : "bg-ink/10")}
            aria-label={open ? "Close menu" : "Open menu"}
            aria-expanded={open}
            onClick={() => setOpen((o) => !o)}
          >
            <span className="relative block h-3 w-4">
              <span className={cn("absolute left-0 h-[1.5px] w-4 bg-current transition-transform", open ? "top-1.5 rotate-45" : "top-0")} />
              <span className={cn("absolute left-0 h-[1.5px] w-4 bg-current transition-transform", open ? "top-1.5 -rotate-45" : "top-3")} />
            </span>
          </button>
        </div>
      </nav>
      {open && (
        <div className={cn("mx-auto mt-2 max-w-[88rem] rounded-3xl p-3 md:hidden", dark ? "bg-ink-2 text-bone ring-1 ring-bone/10" : "bg-white text-ink")}>
          {[...LINKS, { to: "/admin", label: "Staff login" }].map((l) => (
            <NavLink key={l.to} to={l.to} onClick={() => setOpen(false)} className="block rounded-2xl px-4 py-3 text-lg">
              {l.label}
            </NavLink>
          ))}
        </div>
      )}
    </header>
  );
}
