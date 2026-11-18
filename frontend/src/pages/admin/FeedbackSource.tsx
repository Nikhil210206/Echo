import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { PageHead, Skeleton } from "@/components/admin/AdminShell";
import { Button, ErrorNote } from "@/components/ui/kit";
import { api } from "@/lib/api";
import { timeAgo } from "@/lib/format";
import type { FeedbackSource as Source } from "@/lib/types";

export default function FeedbackSource() {
  const { id = "" } = useParams();
  const [record, setRecord] = useState<Source | null>(null);
  const [error, setError] = useState("");
  const [retry, setRetry] = useState(0);

  useEffect(() => {
    let active = true;
    setRecord(null);
    setError("");
    api.feedbackSource(id).then((data) => {
      if (active) setRecord(data);
    }).catch((err: Error) => {
      if (active) setError(err.message);
    });
    return () => { active = false; };
  }, [id, retry]);

  return (
    <>
      <PageHead eyebrow="Source record" title="Campus feedback" />
      {error ? <div className="flex flex-wrap items-center gap-3">
        <ErrorNote>{error}</ErrorNote>
        <Button variant="ghost" onClick={() => setRetry((value) => value + 1)}>Retry</Button>
      </div> : record ? (
        <article className="rounded-[1.5rem] bg-ink-2 p-6 ring-1 ring-bone/10">
          <p className="text-sm text-bone/55">{record.location_name} · {timeAgo(record.created_at)}</p>
          <p className="my-4 whitespace-pre-wrap break-words text-bone/90">{record.text}</p>
          <ul className="space-y-2">
            {record.issues.map((issue) => (
              <li key={issue.id}>
                <Link className="text-lilac hover:underline" to={`/admin/issues/${issue.id}`}>
                  Linked issue · {issue.status.replaceAll("_", " ")}
                </Link>
              </li>
            ))}
          </ul>
        </article>
      ) : <Skeleton className="h-32" />}
    </>
  );
}
