import { useEffect, useState, type FormEvent } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { Empty, PageHead, Skeleton } from "@/components/admin/AdminShell";
import { Button, ErrorNote, Spinner } from "@/components/ui/kit";
import { api, USE_MOCKS } from "@/lib/api";
import { cn } from "@/lib/cn";
import { CATEGORIES, categoryLabel, timeAgo } from "@/lib/format";
import type {
  AssistantResult, AssistantSource, Conversation, ConversationSummary, Location, StatisticsFact, StatisticsRequest,
} from "@/lib/types";

const prompts = [
  "Show recent Wi-Fi complaints.",
  "Which problems at Central Library are unresolved?",
];

const notices: Record<NonNullable<AssistantResult["reason"]>, string> = {
  model_not_configured: "The assistant model is unavailable. Here are results from your search.",
  provider_timeout: "The model took too long. You can retry the question.",
  provider_error: "The model could not answer this time. You can retry the question.",
  invalid_answer: "Echo could not validate the selected evidence.",
  insufficient_evidence: "The assistant found insufficient evidence for a grounded answer.",
  evidence_changed: "The evidence for this answer has changed or is no longer available.",
  statistics_scope_required: "Use Count reports to confirm the filters for an exact total.",
  statistics_unavailable: "Echo could not calculate the report count. Try again.",
  legacy_answer: "This answer predates the current evidence format. Ask again to see verified records.",
};

type Attempt = { id: string; key: string; text: string; statistics?: StatisticsRequest };

function sourcePath(source: AssistantSource) {
  if (!source.record_id) return null;
  const route = source.kind === "issue" ? "issues" : "feedback";
  return `/admin/${route}/${encodeURIComponent(source.record_id)}`;
}

function SourceCard({ source, number }: { source: AssistantSource; number: number }) {
  const path = sourcePath(source);
  const { facts } = source;
  return (
    <li className="min-w-0 rounded-xl bg-ink/65 p-3 text-sm ring-1 ring-bone/10">
      {path ? (
        <Link to={path} className="font-medium text-lilac hover:underline">[{number}] {source.title}</Link>
      ) : <p className="font-medium text-bone">[{number}] {source.title}</p>}
      {source.excerpt && <blockquote className="mt-2 break-words text-bone/65">“{source.excerpt}”</blockquote>}
      {facts.issues?.length ? <ul className="mt-2 flex flex-wrap gap-2 text-xs">
        {facts.issues.map((issue) => (
          <li key={issue.id}>
            <Link className="text-lilac hover:underline" to={`/admin/issues/${encodeURIComponent(issue.id)}`}>
              Issue · {issue.status.replaceAll("_", " ")}
            </Link>
          </li>
        ))}
      </ul> : null}
      {facts.status && <p className="mt-2 text-bone/65">Status · {facts.status.replaceAll("_", " ")}</p>}
      {facts.priority && (
        <p className="mt-1 text-bone/65">
          Priority {facts.priority.score} · {facts.priority.recent_reports} recent reports ·
          urgency ×{facts.priority.urgency_multiplier}
        </p>
      )}
    </li>
  );
}

function CountFact({ fact }: { fact: StatisticsFact }) {
  const { location, category, sentiment, issue_status } = fact.request.filters;
  const utc = (value: string) => new Intl.DateTimeFormat("en", {
    dateStyle: "medium", timeStyle: "medium", timeZone: "UTC",
  }).format(new Date(value));
  return (
    <dl className="space-y-2 text-sm text-bone/80" aria-label="Verified report count">
      <div>
        <dt>Approved reports, including Me too reactions</dt>
        <dd className="mt-1 text-3xl text-bone">{fact.total}</dd>
      </div>
      <div><dt className="sr-only">Scope</dt><dd>{fact.scope === "campus" ? "Campus-wide access" : "Your assigned issues"}</dd></div>
      <div><dt className="sr-only">Date range</dt><dd>
        {fact.start_at ? `From ${utc(fact.start_at)} UTC, before ` : "All reports before "}{utc(fact.end_before)} UTC
      </dd></div>
      <div><dt className="sr-only">Filters</dt><dd>
        {[location, category && categoryLabel(category), sentiment, issue_status?.replaceAll("_", " ")]
          .filter(Boolean).join(" · ") || "All locations, categories and sentiments"}
      </dd></div>
      <div><dt className="sr-only">By overall sentiment</dt><dd>
        {Object.entries(fact.by_overall_sentiment).map(([key, count]) => `${count} ${key}`).join(" · ")}
      </dd></div>
    </dl>
  );
}

function CountReports({ onCount, disabled }: { onCount: (request: StatisticsRequest) => void; disabled: boolean }) {
  const [locations, setLocations] = useState<Location[]>([]);
  const [error, setError] = useState("");
  useEffect(() => {
    let mounted = true;
    api.locations().then((result) => { if (mounted) setLocations(result); })
      .catch(() => { if (mounted) setError("Locations could not be loaded."); });
    return () => { mounted = false; };
  }, []);

  function submitCount(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const value = (name: string) => String(form.get(name) || "") || undefined;
    const date_from = value("date_from");
    const date_to = value("date_to");
    if (date_from && date_to && date_from > date_to) {
      setError("The end date must be on or after the start date.");
      return;
    }
    setError("");
    onCount({ metric: "approved_feedback_count", filters: {
      location: value("location"), category: value("category"),
      sentiment: value("sentiment") as StatisticsRequest["filters"]["sentiment"],
      date_from, date_to,
    } });
  }

  const inputStyle = "mt-1 w-full rounded-lg bg-ink px-2 py-2 text-bone ring-1 ring-bone/15";
  return (
    <details className="rounded-[1.5rem] bg-ink-2 p-4 ring-1 ring-bone/10">
      <summary className="cursor-pointer font-medium text-lilac">Count reports</summary>
      <form onSubmit={submitCount} className="mt-4 space-y-3">
        <p className="text-sm text-bone/70">Confirm filters for an exact count across records you can access.</p>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="text-sm">
            <label htmlFor="count-location">Location</label>
            <select id="count-location" name="location" className={inputStyle}>
              <option value="">All locations</option>
              {locations.map((item) => <option key={item.id} value={item.slug}>{item.name}</option>)}
            </select>
          </div>
          <div className="text-sm">
            <label htmlFor="count-category">Category</label>
            <select id="count-category" name="category" className={inputStyle}>
              <option value="">All categories</option>
              {CATEGORIES.map((category) => <option key={category} value={category}>{categoryLabel(category)}</option>)}
            </select>
          </div>
          <div className="text-sm">
            <label htmlFor="count-sentiment">Sentiment</label>
            <select id="count-sentiment" name="sentiment" className={inputStyle}>
              <option value="">All sentiments</option>
              <option value="negative">Negative</option>
              <option value="neutral">Neutral</option>
              <option value="positive">Positive</option>
            </select>
          </div>
          <label className="text-sm">Start date (UTC)<input name="date_from" type="date" className={inputStyle} /></label>
          <label className="text-sm">End date (UTC)<input name="date_to" type="date" className={inputStyle} /></label>
        </div>
        {error && <ErrorNote>{error}</ErrorNote>}
        <Button type="submit" disabled={disabled}>Get count</Button>
      </form>
    </details>
  );
}

function Answer({ result, onRetry }: { result: AssistantResult; onRetry?: () => void }) {
  const label = result.statistic ? "Recorded count" : result.mode === "grounded" ? "Selected evidence" : "Retrieval only";
  return (
    <div className="rounded-[1.5rem] bg-ink-2 p-5 ring-1 ring-bone/10">
      <p className="mb-2 font-mono text-xs uppercase tracking-wide text-lilac">
        {label}{result.search_mode && ` · ${result.search_mode} search`}
      </p>
      {result.reason && <p className="text-bone/80">{notices[result.reason]}</p>}
      {result.statistic ? <CountFact fact={result.statistic} /> : result.sources.length ? (
        <ul aria-label="Recorded sources" className="mt-3 grid gap-2 md:grid-cols-2">
          {result.sources.map((source, i) => <SourceCard key={source.source_id} source={source} number={i + 1} />)}
        </ul>
      ) : result.reason === "insufficient_evidence" && (
        <p className="mt-2 text-sm text-bone/60">No accessible sources matched. Try a specific topic or location.</p>
      )}
      {onRetry && <Button variant="ghost" className="mt-2" onClick={onRetry}>Retry question</Button>}
    </div>
  );
}

export default function Assistant() {
  const [params, setParams] = useSearchParams();
  const selected = params.get("conversation");
  const [list, setList] = useState<ConversationSummary[]>([]);
  const [mode, setMode] = useState<AssistantResult["mode"]>();
  const [conversation, setConversation] = useState<Conversation | null>(null);
  const [loadError, setLoadError] = useState("");
  const [listError, setListError] = useState("");
  const [sendError, setSendError] = useState("");
  const [reload, setReload] = useState(0);
  const [question, setQuestion] = useState("");
  const [pending, setPending] = useState<Attempt | null>(null);
  const [retryAttempt, setRetryAttempt] = useState<Attempt | null>(null);
  const active = conversation?.id === selected ? conversation : null;

  useEffect(() => {
    if (USE_MOCKS) return;
    let mounted = true;
    setListError("");
    api.assistantConversations().then(({ items, mode }) => {
      if (mounted) { setList(items); setMode(mode); }
    }).catch((err: Error) => { if (mounted) setListError(err.message); });
    return () => { mounted = false; };
  }, [reload]);

  useEffect(() => {
    if (USE_MOCKS || !selected) return;
    let mounted = true;
    setLoadError("");
    api.conversation(selected).then((item) => {
      if (mounted) setConversation(item);
    }).catch((err: Error) => { if (mounted) setLoadError(err.message); });
    return () => { mounted = false; };
  }, [selected, reload]);

  function choose(id?: string) {
    if (id && id === selected) return;
    setParams(id ? { conversation: id } : {});
    setConversation(null);
    setLoadError("");
    setQuestion("");
    setRetryAttempt(null);
    setSendError("");
  }

  async function send(attempt: Attempt) {
    if (pending) return;
    setPending(attempt);
    setSendError("");
    setRetryAttempt(null);
    try {
      if (active?.id !== attempt.id) await api.createConversation(attempt.id);
      const updated = await api.askAssistant(attempt.id, attempt.text, attempt.key, attempt.statistics);
      setConversation(updated);
      setParams({ conversation: updated.id }, { replace: true });
      setList((previous) => [updated, ...previous.filter((row) => row.id !== updated.id)].slice(0, 40));
      if (!attempt.statistics) setQuestion("");
    } catch (err) {
      setSendError((err as Error).message);
      setRetryAttempt(attempt);
    } finally {
      setPending(null);
    }
  }

  function ask(value: string, statistics?: StatisticsRequest) {
    const text = value.trim();
    if (!text) return;
    void send({ id: active?.id ?? crypto.randomUUID(), key: crypto.randomUUID(), text, statistics });
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (retryAttempt?.text === question.trim()) void send(retryAttempt);
    else ask(question);
  }

  const messages = active?.messages ?? [];
  const previous = messages.at(-2);
  const loading = !!selected && !active && !loadError;

  return (
    <div>
      <PageHead eyebrow="Campus feedback" title="Assistant">
        {mode === "retrieval_only" && <p className="rounded-full bg-amber/15 px-3 py-1 text-sm text-amber">Retrieval only</p>}
      </PageHead>
      {USE_MOCKS ? (
        <Empty title="Connect to the Echo API">Set VITE_USE_MOCKS=false to use the assistant and conversation history.</Empty>
      ) : (
        <div className="grid items-start gap-5 lg:grid-cols-[14rem_minmax(0,1fr)]">
          <aside aria-label="Conversations" className="space-y-2 rounded-[1.5rem] bg-ink-2 p-3 ring-1 ring-bone/10">
            <Button variant="ghost" className="w-full" disabled={!!pending} onClick={() => choose()}>New conversation</Button>
            {listError && <div>
              <ErrorNote>{listError}</ErrorNote>
              <Button variant="ghost" onClick={() => setReload((value) => value + 1)}>Retry history</Button>
            </div>}
            {list.length > 0 && (
              <ul className="max-h-72 space-y-1 overflow-y-auto">
                {list.map((row) => (
                  <li key={row.id}>
                    <button onClick={() => choose(row.id)} disabled={!!pending} aria-current={selected === row.id}
                      className={cn("w-full rounded-xl px-3 py-2 text-left hover:bg-bone/10",
                        selected === row.id && "bg-bone/10 text-lilac")}>
                      <span className="block truncate text-sm">{row.title}</span>
                      <span className="block text-xs text-bone/55">{timeAgo(row.updated_at)}</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </aside>

          <section className="min-w-0 space-y-4" aria-label="Assistant conversation">
            {loadError ? <div className="flex flex-wrap items-center gap-3">
              <ErrorNote>{loadError}</ErrorNote>
              <Button variant="ghost" onClick={() => setReload((value) => value + 1)}>Retry conversation</Button>
            </div> : loading ? <Skeleton className="h-40" /> : (
              <>
                {!messages.length && !pending && <Empty title="Ask about campus feedback">
                  <span className="mb-3 block">Explore what people reported, which issues are open, and how priority is calculated.</span>
                  <span className="flex flex-wrap justify-center gap-2">
                    {prompts.map((prompt) => <Button key={prompt} variant="ghost" onClick={() => ask(prompt)}>{prompt}</Button>)}
                  </span>
                </Empty>}
                <ol className="space-y-3">
                  {messages.map((message, i) => (
                    <li key={`${message.turn}-${message.role}`}>
                      {message.role === "user" ? (
                        <p className="ml-auto max-w-[90%] whitespace-pre-wrap break-words rounded-[1.5rem] bg-lilac/15 p-4 text-bone">
                          {message.text}
                        </p>
                      ) : <Answer result={message.result} onRetry={
                        i === messages.length - 1 && !pending && previous?.role === "user" &&
                        ["provider_timeout", "provider_error", "invalid_answer"].includes(message.result.reason ?? "")
                          ? () => ask(previous.text, previous.statistics ?? undefined) : undefined
                      } />}
                    </li>
                  ))}
                </ol>
                {pending && <div role="status" className="space-y-2">
                  <p className="ml-auto max-w-[90%] whitespace-pre-wrap break-words rounded-[1.5rem] bg-lilac/15 p-4">{pending.text}</p>
                  <p className="flex items-center gap-2 text-sm text-bone/60"><Spinner /> Looking up campus feedback…</p>
                </div>}
                {sendError && <div role="alert" className="flex flex-wrap items-center gap-3">
                  <ErrorNote>{sendError}</ErrorNote>
                  {retryAttempt && <Button variant="ghost" onClick={() => void send(retryAttempt)}>Retry message</Button>}
                </div>}
                <form className="flex items-end gap-2 rounded-[1.5rem] bg-ink-2 p-3 ring-1 ring-bone/10" onSubmit={submit}>
                  <label className="sr-only" htmlFor="assistant-question">Ask about campus feedback</label>
                  <textarea id="assistant-question" value={question} onChange={(event) => setQuestion(event.target.value)}
                    maxLength={500} rows={2} disabled={!!pending} placeholder={messages.length ? "Ask a follow-up…" : "Ask about campus feedback…"}
                    className="min-w-0 flex-1 resize-y rounded-xl bg-ink px-3 py-2 outline-none focus:ring-2 focus:ring-lilac" />
                  <Button type="submit" disabled={!!pending || !question.trim()}>{pending ? "Sending…" : "Send"}</Button>
                </form>
                <CountReports disabled={!!pending} onCount={(criteria) => ask("Count approved reports", criteria)} />
              </>
            )}
          </section>
        </div>
      )}
    </div>
  );
}
