import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { QRCodeSVG } from "qrcode.react";
import { PageHead, Skeleton } from "@/components/admin/AdminShell";
import { IconArrowUpRight, IconX } from "@/components/admin/icons";
import { DitherField } from "@/components/fx/DitherField";
import { Button, ErrorNote, LogoMark } from "@/components/ui/kit";
import { api } from "@/lib/api";
import { gsap, useGSAP, prefersReducedMotion } from "@/lib/gsap";
import type { IssueSummary, Location } from "@/lib/types";

/** The address printed in the codes. Set VITE_PUBLIC_URL to the deployed site before printing. */
const PUBLIC_URL = ((import.meta.env.VITE_PUBLIC_URL as string | undefined) || window.location.origin).replace(/\/$/, "");
const urlFor = (l: Location) => `${PUBLIC_URL}/q/${l.slug}`;

export default function QRCodes() {
  const [locs, setLocs] = useState<Location[] | null>(null);
  const [open, setOpen] = useState<Record<number, number>>({});
  const [error, setError] = useState<string | null>(null);
  const [present, setPresent] = useState<Location | null>(null);
  const [copied, setCopied] = useState<number | null>(null);
  const grid = useRef<HTMLUListElement>(null);

  useEffect(() => {
    let alive = true;
    Promise.all([api.locations(), api.issues({ status: "active" })])
      .then(([l, issues]) => {
        if (!alive) return;
        setLocs(l);
        const counts: Record<number, number> = {};
        issues.forEach((i: IssueSummary) => (counts[i.location_id] = (counts[i.location_id] ?? 0) + 1));
        setOpen(counts);
      })
      .catch((e: Error) => alive && setError(e.message));
    return () => {
      alive = false;
    };
  }, []);

  useGSAP(
    () => {
      if (!locs || prefersReducedMotion()) return;
      gsap.fromTo(".qr-card", { y: 30, opacity: 0, rotate: 1.5 }, { y: 0, opacity: 1, rotate: 0, stagger: 0.07, duration: 0.9 });
    },
    { scope: grid, dependencies: [!!locs] },
  );

  async function copy(l: Location) {
    try {
      await navigator.clipboard.writeText(urlFor(l));
      setCopied(l.id);
      setTimeout(() => setCopied(null), 1500);
    } catch {
      /* the link is visible on the card */
    }
  }

  return (
    <div>
      <PageHead
        eyebrow="Point of experience"
        title={
          <>
            QR <span className="serif-accent text-lilac">codes</span>
          </>
        }
      />
      <p className="-mt-4 mb-8 max-w-2xl text-bone/55">
        One code per place. Scanning opens the feedback form with the location already filled in, so people report where it happens.
        {PUBLIC_URL.includes("localhost") && (
          <span className="mt-2 block text-amber">
            These codes point at {PUBLIC_URL}, which phones can't reach. Set VITE_PUBLIC_URL to the deployed address before the demo.
          </span>
        )}
      </p>

      {error && <ErrorNote className="mb-4">{error}</ErrorNote>}

      <ul ref={grid} className="grid gap-4 sm:grid-cols-2 2xl:grid-cols-3">
        {!locs &&
          Array.from({ length: 5 }).map((_, i) => (
            <li key={i}>
              <Skeleton className="h-96" />
            </li>
          ))}
        {locs?.map((l) => (
          <li key={l.id} className="qr-card flex flex-col rounded-[1.75rem] bg-bone p-5 text-ink">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="eyebrow text-ink/45">{l.zone}</p>
                <h2 className="display-soft mt-1 text-2xl">{l.name}</h2>
              </div>
              <span className="rounded-full bg-ink/[0.06] px-2.5 py-1 text-xs text-ink/60">{open[l.id] ?? 0} open</span>
            </div>
            <div className="my-5 grid place-items-center rounded-2xl bg-white p-5">
              <QRCodeSVG value={urlFor(l)} size={180} level="M" fgColor="#0d0d10" bgColor="#ffffff" />
            </div>
            <p className="truncate font-mono text-xs text-ink/50" title={urlFor(l)}>
              {urlFor(l).replace(/^https?:\/\//, "")}
            </p>
            <div className="mt-4 flex flex-wrap gap-2">
              <Button size="sm" variant="cobalt" onClick={() => setPresent(l)}>
                Present
              </Button>
              <Button size="sm" variant="ghost-dark" onClick={() => copy(l)}>
                {copied === l.id ? "Copied" : "Copy link"}
              </Button>
              <a
                href={`/q/${l.slug}`}
                target="_blank"
                rel="noreferrer"
                className="ml-auto grid h-9 w-9 place-items-center rounded-full text-ink/50 hover:bg-ink/5 hover:text-ink"
                aria-label={`Open the ${l.name} form`}
              >
                <IconArrowUpRight />
              </a>
            </div>
          </li>
        ))}
      </ul>

      {present && createPortal(<Presenter location={present} onClose={() => setPresent(null)} />, document.body)}
    </div>
  );
}

/** Full-screen code for the stage: judges scan it from their seats. */
function Presenter({ location, onClose }: { location: Location; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const key = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", key);
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", key);
      document.body.style.overflow = "";
    };
  }, [onClose]);

  useGSAP(
    () => {
      if (prefersReducedMotion()) return;
      gsap.fromTo(ref.current, { clipPath: "circle(0% at 50% 50%)" }, { clipPath: "circle(150% at 50% 50%)", duration: 1.1, ease: "power3.inOut" });
      gsap.fromTo(".pr-qr", { scale: 0.7, rotate: -6, opacity: 0 }, { scale: 1, rotate: 0, opacity: 1, duration: 1.2, delay: 0.35, ease: "back.out(1.4)" });
      gsap.fromTo(".pr-text", { y: 30, opacity: 0 }, { y: 0, opacity: 1, stagger: 0.1, duration: 0.9, delay: 0.5 });
    },
    { scope: ref },
  );

  return (
    <div ref={ref} role="dialog" aria-modal="true" aria-label={`QR code for ${location.name}`} className="print-area fixed inset-0 z-[100] overflow-hidden bg-cobalt text-bone">
      <DitherField cell={7} palette={["#2a1dd9", "#5446ff", "#9b91ff", "#d9d4ff"]} sources={[{ x: 0.72, y: 0.5, strength: 1.4 }]} floor={0.2} glow={160} />
      <div className="relative z-10 grid h-full items-center gap-10 p-8 lg:grid-cols-[1.1fr_1fr] lg:p-16">
        <div>
          <p className="pr-text eyebrow flex items-center gap-2 text-lilac">
            <LogoMark className="h-5 w-5 text-bone" /> Scan to report
          </p>
          <h2 className="pr-text display mt-6 text-[clamp(3.2rem,6.5vw,7rem)]">
            You're at
            <br />
            <span className="serif-accent text-lilac">{location.name}.</span>
          </h2>
          <p className="pr-text mt-6 max-w-md text-xl text-bone/75">Point your camera here. Tell us what's wrong, or tap “Me too” on something already reported.</p>
          <p className="pr-text mt-8 font-mono text-lg text-bone/60">{urlFor(location).replace(/^https?:\/\//, "")}</p>
        </div>
        <div className="pr-qr mx-auto rounded-[2.5rem] bg-white p-8 shadow-[0_40px_120px_-20px_rgba(0,0,0,.5)]">
          <QRCodeSVG value={urlFor(location)} size={420} level="M" fgColor="#0d0d10" bgColor="#ffffff" className="h-auto w-[min(70vw,62vh,26rem)]" />
        </div>
      </div>
      <div className="absolute right-5 top-5 z-20 flex gap-2 print:hidden">
        <button onClick={() => window.print()} className="rounded-full bg-bone/15 px-4 py-2.5 text-sm backdrop-blur hover:bg-bone/25">
          Print
        </button>
        <button onClick={onClose} aria-label="Close" className="grid h-10 w-10 place-items-center rounded-full bg-bone/15 backdrop-blur hover:bg-bone/25">
          <IconX />
        </button>
      </div>
    </div>
  );
}
