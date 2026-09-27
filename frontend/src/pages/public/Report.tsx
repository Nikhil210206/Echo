import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { PublicNav } from "@/components/layout/PublicNav";
import { SplitReveal } from "@/components/fx/motion";
import { ErrorNote } from "@/components/ui/kit";
import { api } from "@/lib/api";
import { gsap, useGSAP, prefersReducedMotion } from "@/lib/gsap";
import type { Location } from "@/lib/types";

export default function Report() {
  const [locations, setLocations] = useState<Location[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const list = useRef<HTMLUListElement>(null);

  useEffect(() => {
    let alive = true;
    api
      .locations()
      .then((l) => alive && setLocations(l))
      .catch((e: Error) => alive && setError(e.message));
    return () => {
      alive = false;
    };
  }, []);

  useGSAP(
    () => {
      if (!locations || prefersReducedMotion()) return;
      gsap.from(".loc-row", { y: 40, opacity: 0, stagger: 0.07, duration: 1, delay: 0.2 });
    },
    { scope: list, dependencies: [locations?.length] },
  );

  return (
    <>
      <PublicNav tone="light" />
      <main className="min-h-[100svh] bg-bone px-5 pb-24 pt-32 text-ink sm:px-8">
        <div className="mx-auto max-w-[70rem]">
          <p className="eyebrow mb-5 text-ink/50">Report an issue</p>
          <SplitReveal as="h1" className="display text-[clamp(3.2rem,9vw,8.5rem)]">
            Where are <span className="serif-accent text-cobalt">you?</span>
          </SplitReveal>
          <p className="mt-6 max-w-md text-lg text-ink/60">
            On campus you'd scan the QR code on the wall, and this step is skipped. Pick the place the problem is.
          </p>

          {error && <ErrorNote className="mt-10">{error}</ErrorNote>}

          <ul ref={list} className="mt-14 border-t border-ink/15">
            {!locations &&
              !error &&
              Array.from({ length: 5 }).map((_, i) => <li key={i} className="h-24 animate-pulse border-b border-ink/10 bg-ink/[0.03]" />)}
            {locations?.map((l) => (
              <li key={l.id} className="loc-row border-b border-ink/15">
                <Link
                  to={`/q/${l.slug}`}
                  className="group relative flex items-center justify-between gap-6 overflow-hidden py-7 transition-colors duration-500 hover:text-bone"
                >
                  <span className="absolute inset-0 origin-bottom scale-y-0 bg-cobalt transition-transform duration-500 ease-[var(--ease-out-expo)] group-hover:scale-y-100" />
                  <span className="relative flex items-baseline gap-5 pl-0 transition-[padding] duration-500 group-hover:pl-5">
                    <span className="display-soft text-[clamp(1.8rem,4vw,3.4rem)]">{l.name}</span>
                    <span className="eyebrow hidden opacity-50 sm:inline">{l.zone}</span>
                  </span>
                  <span className="relative pr-0 font-mono text-sm opacity-60 transition-[padding,opacity] duration-500 group-hover:pr-5 group-hover:opacity-100">
                    /q/{l.slug} →
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </div>
      </main>
    </>
  );
}
