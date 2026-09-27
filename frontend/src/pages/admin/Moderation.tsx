import { useEffect, useRef, useState } from "react";
import { Empty, PageHead, Skeleton, useConsole } from "@/components/admin/AdminShell";
import { Button, ErrorNote, Spinner } from "@/components/ui/kit";
import { api } from "@/lib/api";
import { cn } from "@/lib/cn";
import { timeAgo } from "@/lib/format";
import { gsap, prefersReducedMotion } from "@/lib/gsap";
import { useLive } from "@/lib/live";
import type { FeedbackRecord, ModerationFlag } from "@/lib/types";

const FLAG: Record<ModerationFlag, { label: string; why: string }> = {
  spam: { label: "Spam", why: "Links or promotion, not feedback" },
  gibberish: { label: "Gibberish", why: "Doesn't read as words" },
  duplicate_flood: { label: "Duplicate flood", why: "The same word repeated over and over" },
  off_topic: { label: "Off-topic", why: "Nothing to do with campus services" },
  abusive: { label: "Abusive", why: "Attacks a person. The complaint inside may still be valid" },
  profanity_masked: { label: "Profanity masked", why: "Kept, with the swear words hidden" },
};

const INSULT = "(?:a\\s+)?(?:total\\s+)?(?:idiot|stupid|useless|clown|moron)";
const ABUSE = new RegExp(`\\b${INSULT}(?:\\s+${INSULT})*\\b`, "gi");

export default function Moderation() {
  const { refreshPending } = useConsole();
  const [queue, setQueue] = useState<FeedbackRecord[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [handled, setHandled] = useState(0);

  const load = () =>
    api
      .moderationQueue()
      .then(setQueue)
      .catch((e: Error) => setError(e.message));

  useEffect(() => {
    let alive = true;
    api
      .moderationQueue()
      .then((q) => alive && setQueue(q))
      .catch((e: Error) => alive && setError(e.message));
    return () => {
      alive = false;
    };
  }, []);

  useLive((e) => {
    if (e.type === "moderation") load();
  });

  const done = (id: number) => {
    setQueue((q) => q?.filter((x) => x.id !== id) ?? null);
    setHandled((h) => h + 1);
    refreshPending();
  };

  return (
    <div>
      <PageHead
        eyebrow="Human in the loop"
        title={
          <>
            Moderation <span className="serif-accent text-lilac">queue</span>
          </>
        }
      >
        {handled > 0 && <p className="font-mono text-sm text-mint">{handled} handled this session</p>}
      </PageHead>
      <p className="-mt-4 mb-8 max-w-2xl text-bone/55">
        Only these were held back. Angry isn't abusive: complaints with swearing go straight through with the words masked. Anything
        attacking a person, spam or gibberish waits here for a human.
      </p>

      {error && <ErrorNote className="mb-4">{error}</ErrorNote>}

      {!queue ? (
        <div className="grid gap-3 lg:grid-cols-2">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-52" />
          ))}
        </div>
      ) : queue.length === 0 ? (
        <Empty title="Queue clear">Nothing is waiting. New flagged items appear here as they arrive.</Empty>
      ) : (
        <ul className="grid gap-3 lg:grid-cols-2">
          {queue.map((f) => (
            <QueueCard key={f.id} item={f} onDone={() => done(f.id)} />
          ))}
        </ul>
      )}
    </div>
  );
}

function QueueCard({ item, onDone }: { item: FeedbackRecord; onDone: () => void }) {
  const ref = useRef<HTMLLIElement>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(() => (item.text_redacted ?? "").replace(ABUSE, "[removed]"));
  const abusive = item.flags.includes("abusive");

  async function act(action: "approve" | "reject" | "redact") {
    setBusy(action);
    setError(null);
    try {
      await api.moderate(item.id, action, action === "redact" ? draft : undefined);
      const el = ref.current;
      if (el && !prefersReducedMotion()) {
        await gsap.to(el, { x: action === "reject" ? -60 : 60, opacity: 0, duration: 0.45, ease: "power2.in" });
        await gsap.to(el, { height: 0, marginTop: 0, paddingTop: 0, paddingBottom: 0, duration: 0.3 });
      }
      onDone();
    } catch (e) {
      setError((e as Error).message);
      setBusy(null);
    }
  }

  return (
    <li ref={ref} className="flex flex-col overflow-hidden rounded-[1.5rem] bg-ink-2 p-5 ring-1 ring-bone/[0.06]">
      <div className="mb-4 flex flex-wrap items-center gap-2">
        {item.flags.map((fl) => (
          <span
            key={fl}
            title={FLAG[fl].why}
            className={cn("eyebrow rounded-full px-2.5 py-1 !text-[0.62rem]", fl === "abusive" ? "bg-signal text-ink" : "bg-amber/15 text-amber")}
          >
            {FLAG[fl].label}
          </span>
        ))}
        <span className="ml-auto text-xs text-bone/40">
          {item.location_name} · {timeAgo(item.created_at)}
        </span>
      </div>

      {editing ? (
        <>
          <label htmlFor={`redact-${item.id}`} className="mb-2 text-xs text-bone/50">
            Edit out the abuse, keep the complaint
          </label>
          <textarea
            id={`redact-${item.id}`}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            rows={3}
            className="w-full resize-none rounded-2xl bg-ink px-4 py-3 text-lg leading-relaxed outline-none ring-2 ring-lilac"
          />
        </>
      ) : (
        <p className="serif-accent text-[1.45rem] leading-snug text-bone/85">“{item.text_redacted}”</p>
      )}

      <p className="mt-3 text-sm text-bone/45">{item.flags.map((f) => FLAG[f].why).join(". ")}.</p>

      {error && <ErrorNote className="mt-3">{error}</ErrorNote>}

      <div className="mt-5 flex flex-wrap gap-2 border-t border-bone/[0.06] pt-4">
        {editing ? (
          <>
            <Button size="sm" variant="mint" onClick={() => act("redact")} disabled={busy !== null}>
              {busy === "redact" ? <Spinner /> : "Approve edited"}
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setEditing(false)} disabled={busy !== null}>
              Cancel
            </Button>
          </>
        ) : (
          <>
            {abusive ? (
              <Button size="sm" variant="mint" onClick={() => setEditing(true)} disabled={busy !== null}>
                Redact and keep
              </Button>
            ) : (
              <Button size="sm" variant="ghost" onClick={() => act("approve")} disabled={busy !== null}>
                {busy === "approve" ? <Spinner /> : "Approve anyway"}
              </Button>
            )}
            <Button size="sm" variant="signal" className="ml-auto" onClick={() => act("reject")} disabled={busy !== null}>
              {busy === "reject" ? <Spinner /> : "Reject"}
            </Button>
          </>
        )}
      </div>
    </li>
  );
}
