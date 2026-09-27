// Typed client for the Echo API. With VITE_USE_MOCKS unset or "true" it talks
// to the in-memory mock store; set VITE_USE_MOCKS=false to hit the backend.
import { MockError, mock } from "@/mocks/store";
import type {
  AnalyticsSummary,
  ApiErrorBody,
  FeedbackQuery,
  FeedbackRecord,
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
    throw new ApiError("NETWORK", "Can't reach Echo right now. Check your connection and try again.");
  }
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as ApiErrorBody | null;
    throw new ApiError(
      body?.error.code ?? "HTTP_ERROR",
      body?.error.message ?? "Something went wrong on our side. Try again in a moment.",
      res.status,
      body?.error.fields,
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
    USE_MOCKS ? fake(() => mock.searchFeedback(token, q), 260) : cachedRequest(`/feedback${qs(q)}`),

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

/**
 * Live events. The backend streams them over SSE; EventSource can't send an
 * Authorization header, so the token rides in the query string (short-lived on
 * the server side). The mock store pushes the same events in-process.
 */
export function subscribeLive(onEvent: (e: LiveEvent) => void, onStatus?: (live: boolean) => void): () => void {
  if (USE_MOCKS) {
    onStatus?.(true);
    return mock.subscribe(onEvent);
  }
  if (!token) {
    onStatus?.(false);
    return () => {};
  }
  // All subscribers share one EventSource. Each open stream permanently holds one of the browser's
  // ~6 connections to the API host, so one per subscriber starved normal requests.
  if (live && live.token !== token) closeLive();
  if (!live) live = openLive(token);
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
let live: { token: string; src: EventSource; subs: Set<LiveSub>; connected: boolean } | null = null;

function openLive(tok: string) {
  const conn = {
    token: tok,
    src: new EventSource(`${API_BASE}/api/stream${qs({ token: tok })}`, { withCredentials: true }),
    subs: new Set<LiveSub>(),
    connected: false,
  };
  const setStatus = (up: boolean) => {
    conn.connected = up;
    conn.subs.forEach((s) => s.onStatus?.(up));
  };
  conn.src.onopen = () => setStatus(true);
  conn.src.onerror = () => setStatus(false);
  conn.src.onmessage = (m) => {
    let e: LiveEvent;
    try {
      e = JSON.parse(m.data) as LiveEvent;
    } catch {
      return; /* ignore malformed frames */
    }
    // Something changed on the server: drop cached responses so the refetches this triggers get fresh data
    clearApiCache();
    conn.subs.forEach((s) => s.onEvent(e));
  };
  return conn;
}

function closeLive() {
  live?.src.close();
  live = null;
}
