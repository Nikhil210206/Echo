// Typed client for the Echo API. With VITE_USE_MOCKS unset or "true" it talks
// to the in-memory mock store; set VITE_USE_MOCKS=false to hit the backend.
import { MockError, mock } from "@/mocks/store";
import { readEventStream } from "./eventStream";
import type {
  AnalyticsSummary,
  ApiErrorBody,
  AssistantResult,
  Conversation,
  ConversationSummary,
  FeedbackHit,
  FeedbackQuery,
  FeedbackRecord,
  FeedbackSource,
  IssueDetail,
  IssueQuery,
  IssueSummary,
  IssueUpdate,
  LiveEvent,
  Location,
  LoginResult,
  MeTooResult,
  Page,
  PublicIssue,
  PublicStats,
  SemanticQuery,
  StatisticsRequest,
  TickerItem,
  SpikeAlert,
  SubmitFeedbackInput,
  SubmitFeedbackResult,
  TrackResult,
  Trend,
  User,
} from "./types";

export const API_BASE = (import.meta.env.VITE_API_URL as string | undefined)?.replace(/\/$/, "") ?? "http://localhost:8000";
export const USE_MOCKS = import.meta.env.VITE_USE_MOCKS !== "false";

export class ApiError extends Error {
  code: string;
  fields?: Record<string, string>;
  status: number;
  constructor(code: string, message: string, status = 0, fields?: Record<string, string>) {
    super(message);
    this.code = code;
    this.status = status;
    this.fields = fields;
  }
}

/* ---- session token ------------------------------------------------------ */

const TOKEN_KEY = "echo.token";
let token: string | null = (() => {
  try {
    return sessionStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
})();
export function setToken(t: string | null) {
  if (token !== t) closeLive();
  token = t;
  try {
    if (t) sessionStorage.setItem(TOKEN_KEY, t);
    else sessionStorage.removeItem(TOKEN_KEY);
  } catch {
    /* private mode: stay signed in for this tab only */
  }
}
export const getToken = () => token;

/* ---- transport ---------------------------------------------------------- */

async function request<T>(path: string, init?: RequestInit & { json?: unknown }): Promise<T> {
  const { json, ...rest } = init ?? {};
  let res: Response;
  try {
    res = await fetch(`${API_BASE}/api${path}`, {
      ...rest,
      headers: {
        ...(json !== undefined ? { "Content-Type": "application/json" } : {}),
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...rest.headers,
      },
      body: json !== undefined ? JSON.stringify(json) : rest.body,
      credentials: "include",
    });
  } catch {
    if (rest.signal?.aborted) throw new ApiError("TIMEOUT", "The request took too long. Try again.");
    throw new ApiError("NETWORK", "Can't reach Echo right now. Check your connection and try again.");
  }
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as ApiErrorBody | null;
    throw new ApiError(
      body?.error?.code ?? "HTTP_ERROR",
      body?.error?.message ?? "Something went wrong on our side. Try again in a moment.",
      res.status,
      body?.error?.fields,
    );
  }
  return res.json() as Promise<T>;
}

const cache = new Map<string, { timestamp: number; promise: Promise<unknown> }>();

export function clearApiCache() {
  cache.clear();
}

async function cachedRequest<T>(path: string, ttlMs = 5000): Promise<T> {
  const now = Date.now();
  const hit = cache.get(path);
  if (hit && now - hit.timestamp < ttlMs) {
    return hit.promise as Promise<T>;
  }
  const promise = request<T>(path).catch((err) => {
    cache.delete(path);
    throw err;
  });
  cache.set(path, { timestamp: now, promise });
  return promise;
}

/** Runs a mock operation with realistic latency and the same error shape as the API. */
function fake<T>(fn: () => T, ms = 380): Promise<T> {
  return new Promise((resolve, reject) =>
    setTimeout(() => {
      try {
        resolve(structuredClone(fn()));
      } catch (e) {
        if (e instanceof MockError) {
          const status = e.code === "UNAUTHORIZED" ? 401 : e.code === "FORBIDDEN" ? 403 : e.code === "NOT_FOUND" ? 404 : 400;
          reject(new ApiError(e.code, e.message, status, e.fields));
        } else reject(e);
      }
    }, ms + Math.random() * 220),
  );
}

const qs = (o: object) => {
  const p = new URLSearchParams();
  Object.entries(o).forEach(([k, v]) => v !== undefined && v !== "" && v !== null && p.set(k, String(v)));
  const s = p.toString();
  return s ? `?${s}` : "";
};

function backendRequest<T>(path: string, init?: RequestInit & { json?: unknown }): Promise<T> {
  if (USE_MOCKS) return Promise.reject(new ApiError("BACKEND_REQUIRED", "Connect to the Echo API to use this feature."));
  return request(path, { ...init, signal: AbortSignal.timeout(35_000) });
}

/* ---- endpoints ---------------------------------------------------------- */

export const api = {
  /* public */
  locations: (): Promise<Location[]> => (USE_MOCKS ? fake(mock.listLocations, 120) : cachedRequest("/locations/public")),

  location: (slug: string): Promise<Location> =>
    USE_MOCKS ? fake(() => mock.getLocation(slug), 150) : cachedRequest(`/locations/${encodeURIComponent(slug)}`),

  locationIssues: (slug: string): Promise<IssueSummary[]> =>
    USE_MOCKS ? fake(() => mock.locationIssues(slug)) : cachedRequest(`/locations/${encodeURIComponent(slug)}/issues`),

  meToo: (issueId: string | number, deviceId: string): Promise<MeTooResult> => {
    clearApiCache();
    return USE_MOCKS
      ? fake(() => mock.meToo(Number(issueId), deviceId))
      : request(`/issues/${issueId}/metoo`, { method: "POST", json: { device_id: deviceId } });
  },

  submitFeedback: (input: SubmitFeedbackInput): Promise<SubmitFeedbackResult> => {
    clearApiCache();
    return USE_MOCKS ? fake(() => mock.submit(input), 1400) : request("/feedback", { method: "POST", json: input });
  },

  track: (code: string): Promise<TrackResult> =>
    USE_MOCKS ? fake(() => mock.track(code), 250) : cachedRequest(`/track/${encodeURIComponent(code)}`),

  verify: (code: string, issueId: string | number, fixed: boolean): Promise<TrackResult> => {
    clearApiCache();
    return USE_MOCKS
      ? fake(() => mock.verify(code, Number(issueId), fixed))
      : request(`/track/${encodeURIComponent(code)}/verify`, { method: "POST", json: { issue_id: issueId, fixed } });
  },

  publicStats: (): Promise<PublicStats> => (USE_MOCKS ? fake(mock.publicStats, 200) : cachedRequest("/public/stats")),

  publicIssues: (): Promise<PublicIssue[]> => (USE_MOCKS ? fake(mock.publicIssues, 260) : cachedRequest("/public/issues")),

  ticker: (): Promise<TickerItem[]> => (USE_MOCKS ? fake(mock.ticker, 100) : cachedRequest("/public/ticker")),

  /* auth */
  login: (email: string, password: string): Promise<LoginResult> => {
    clearApiCache();
    return USE_MOCKS ? fake(() => mock.login(email, password), 600) : request("/auth/login", { method: "POST", json: { email, password } });
  },

  me: (): Promise<User> => (USE_MOCKS ? fake(() => mock.me(token), 120) : cachedRequest("/auth/me")),

  /* staff console */
  staff: (): Promise<User[]> => (USE_MOCKS ? fake(() => mock.staff(token), 150) : cachedRequest("/users?role=staff")),

  issues: (q: IssueQuery = {}): Promise<IssueSummary[]> =>
    USE_MOCKS ? fake(() => mock.listIssues(token, q), 280) : cachedRequest(`/issues${qs(q)}`),

  issue: (id: string | number): Promise<IssueDetail> => (USE_MOCKS ? fake(() => mock.getIssue(token, Number(id)), 260) : cachedRequest(`/issues/${id}`)),

  updateIssue: (id: string | number, patch: IssueUpdate): Promise<IssueDetail> => {
    clearApiCache();
    return USE_MOCKS ? fake(() => mock.updateIssue(token, Number(id), patch), 420) : request(`/issues/${id}`, { method: "PATCH", json: patch });
  },

  feedback: (q: FeedbackQuery): Promise<Page<FeedbackRecord>> =>
    USE_MOCKS ? fake(() => mock.searchFeedback(token, { ...q, location_id: q.location_id ? Number(q.location_id) : undefined }), 260) : cachedRequest(`/feedback${qs(q)}`),

  semanticFeedback: (query: SemanticQuery): Promise<FeedbackHit[]> =>
    backendRequest(`/feedback/semantic${qs(query)}`),

  feedbackSource: (id: string): Promise<FeedbackSource> => backendRequest(`/feedback/sources/${encodeURIComponent(id)}`),

  assistantConversations: (): Promise<{ items: ConversationSummary[]; mode: AssistantResult["mode"] }> =>
    backendRequest("/assistant/conversations"),

  createConversation: (id: string): Promise<ConversationSummary> =>
    backendRequest(`/assistant/conversations/${encodeURIComponent(id)}`, { method: "PUT" }),

  conversation: (id: string): Promise<Conversation> => backendRequest(`/assistant/conversations/${encodeURIComponent(id)}`),

  askAssistant: (id: string, question: string, requestId: string, statistics?: StatisticsRequest): Promise<Conversation> =>
    backendRequest(`/assistant/conversations/${encodeURIComponent(id)}/messages`, {
      method: "POST", json: { question, request_id: requestId, statistics },
    }),

  recentFeed: (): Promise<FeedbackRecord[]> =>
    USE_MOCKS ? fake(() => mock.recentFeed(token), 150) : cachedRequest(`/feedback${qs({ page_size: 8, status: "approved" })}`).then((p) => (p as Page<FeedbackRecord>).items),

  moderationQueue: (): Promise<FeedbackRecord[]> =>
    USE_MOCKS ? fake(() => mock.moderationQueue(token), 220) : cachedRequest("/moderation/queue"),

  moderate: (id: string | number, action: "approve" | "reject" | "redact", text?: string): Promise<FeedbackRecord> => {
    clearApiCache();
    return USE_MOCKS
      ? fake(() => mock.moderate(token, Number(id), action, text), 360)
      : request(`/feedback/${id}/moderation`, { method: "PATCH", json: { action, text } });
  },

  analytics: (days = 42): Promise<AnalyticsSummary> =>
    USE_MOCKS ? fake(() => mock.analytics(token, days), 320) : cachedRequest(`/analytics/summary${qs({ days })}`),

  alerts: (): Promise<{ spikes: SpikeAlert[]; trends: Trend[] }> => (USE_MOCKS ? fake(mock.alerts, 200) : cachedRequest("/alerts")),

  dashboardSummary: (): Promise<{ analytics: AnalyticsSummary; issues: IssueSummary[]; alerts: { spikes: SpikeAlert[]; trends: Trend[] }; stats: PublicStats }> =>
    USE_MOCKS
      ? Promise.all([api.analytics(), api.issues({ status: "active" }), api.alerts(), api.publicStats()]).then(
          ([analytics, issues, alerts, stats]) => ({ analytics, issues, alerts, stats }),
        )
      : cachedRequest("/dashboard/summary"),
};

/** Share a single authenticated SSE connection across the admin's subscribers. */
export function subscribeLive(onEvent: (e: LiveEvent) => void, onStatus?: (live: boolean) => void): () => void {
  if (USE_MOCKS) {
    onStatus?.(true);
    return mock.subscribe(onEvent);
  }
  if (!token) {
    onStatus?.(false);
    return () => {};
  }
  if (live && live.token !== token) closeLive();
  if (!live) {
    live = { token, controller: new AbortController(), subs: new Set(), connected: false, retryMs: 1000 };
    void readLive(live);
  }
  const sub = { onEvent, onStatus };
  live.subs.add(sub);
  onStatus?.(live.connected);
  const mine = live;
  return () => {
    mine.subs.delete(sub);
    if (mine.subs.size === 0 && live === mine) closeLive();
  };
}

type LiveSub = { onEvent: (e: LiveEvent) => void; onStatus?: (live: boolean) => void };
type LiveConnection = {
  token: string;
  controller: AbortController;
  subs: Set<LiveSub>;
  connected: boolean;
  retryMs: number;
  timer?: ReturnType<typeof setTimeout>;
};
let live: LiveConnection | null = null;

function setLiveStatus(conn: LiveConnection, connected: boolean) {
  if (conn.connected === connected) return;
  conn.connected = connected;
  conn.subs.forEach((s) => s.onStatus?.(connected));
}

async function readLive(conn: LiveConnection) {
  const { signal } = conn.controller;
  let retry = true;
  try {
    const response = await fetch(`${API_BASE}/api/stream`, {
      headers: { Accept: "text/event-stream", Authorization: `Bearer ${conn.token}` },
      credentials: "include",
      signal,
    });
    retry = response.status !== 401 && response.status !== 403 && response.status !== 204;
    if (signal.aborted || !response.ok || !response.body ||
      !response.headers.get("content-type")?.startsWith("text/event-stream")) {
      await response.body?.cancel();
      return;
    }
    conn.retryMs = 1000;
    setLiveStatus(conn, true);
    await readEventStream(response.body, (data) => {
      if (signal.aborted) return;
      let event: LiveEvent;
      try {
        event = JSON.parse(data) as LiveEvent;
      } catch {
        return;
      }
      if (!event || typeof event.type !== "string") return;
      clearApiCache();
      conn.subs.forEach((s) => s.onEvent(event));
    });
  } catch {
    // Network, decoding, and stream failures use the same reconnect path.
  } finally {
    setLiveStatus(conn, false);
    if (retry && !signal.aborted) {
      conn.timer = setTimeout(() => void readLive(conn), conn.retryMs);
      conn.retryMs = Math.min(conn.retryMs * 2, 15_000);
    }
  }
}

function closeLive() {
  if (!live) return;
  clearTimeout(live.timer);
  live.controller.abort();
  setLiveStatus(live, false);
  live = null;
}
