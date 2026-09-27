// In-memory stand-in for the backend. It follows the rules the real API will
// (aspect-level analysis, clustering by category + location, the priority formula,
// spike detection, me-too once per device, the 30% / min-3 reopen rule, PII masking)
// so every screen can be built and demoed before the endpoints land.
//
// Feedback rows are the source of truth: issue counts, priority, charts, spikes and
// public stats are all derived from them, so the numbers always agree with each other.
import type {
  AnalyticsSummary,
  Aspect,
  EvidenceItem,
  FeedbackQuery,
  FeedbackRecord,
  IssueDetail,
  IssueEvent,
  IssueQuery,
  IssueStatus,
  IssueSummary,
  IssueUpdate,
  LiveEvent,
  Location,
  LoginResult,
  MeTooResult,
  ModerationFlag,
  Page,
  PriorityBreakdown,
  PublicIssue,
  PublicStats,
  Sentiment,
  SpikeAlert,
  SubmitFeedbackInput,
  SubmitFeedbackResult,
  TrackResult,
  Trend,
  Urgency,
  User,
} from "@/lib/types";

const DAY = 86_400_000;
const now = Date.now();
const ago = (days: number) => new Date(now - days * DAY).toISOString();

export class MockError extends Error {
  code: string;
  fields?: Record<string, string>;
  constructor(code: string, message: string, fields?: Record<string, string>) {
    super(message);
    this.code = code;
    this.fields = fields;
  }
}

/* ======================================================================== */
/* Reference data                                                          */
/* ======================================================================== */

export const locations: Location[] = [
  { id: 1, name: "Hostel Block 3", slug: "hostel-b3", zone: "Residences" },
  { id: 2, name: "Mess A", slug: "mess-a", zone: "Dining" },
  { id: 3, name: "Central Library", slug: "library", zone: "Academics" },
  { id: 4, name: "Tech Park Labs", slug: "labs", zone: "Academics" },
  { id: 5, name: "Bus Bay", slug: "bus-bay", zone: "Transport" },
];
const locName = (id: number) => locations.find((l) => l.id === id)!.name;

export const CATEGORIES = ["Wi-Fi", "Food", "Hygiene", "Maintenance", "Transport", "Labs", "Library"];

export const DEMO_PASSWORD = "echo-demo";
export const users: User[] = [
  { id: 1, name: "Campus admin", email: "admin@echo.test", role: "admin", team: null },
  { id: 2, name: "IT services", email: "it@echo.test", role: "staff", team: "Wi-Fi & IT" },
  { id: 3, name: "Mess manager", email: "mess@echo.test", role: "staff", team: "Dining" },
  { id: 4, name: "Estate office", email: "estate@echo.test", role: "staff", team: "Maintenance" },
  { id: 5, name: "Transport desk", email: "transport@echo.test", role: "staff", team: "Transport" },
];
const userRef = (id: number | null) => {
  const u = users.find((x) => x.id === id);
  return u ? { id: u.id, name: u.name } : null;
};

/* ======================================================================== */
/* Seeded generator                                                        */
/* ======================================================================== */

function mulberry32(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rnd = mulberry32(20260927);
const pick = <T,>(xs: T[]) => xs[Math.floor(rnd() * xs.length)];
/** A realistic timestamp between `from` and `to` days ago, during waking hours */
function when(from: number, to: number) {
  const d = to + rnd() * (from - to);
  const t = new Date(now - d * DAY);
  t.setHours(8 + Math.floor(rnd() * 15), Math.floor(rnd() * 60));
  return Math.min(t.getTime(), now - 60_000);
}

const ALPHABET = "23456789ABCDEFGHJKMNPQRSTUVWXYZ";
const codes = new Set<string>();
function newCode(): string {
  let c = "ECH-";
  for (let i = 0; i < 4; i++) c += ALPHABET[Math.floor(Math.random() * ALPHABET.length)];
  if (codes.has(c)) return newCode();
  codes.add(c);
  return c;
}
function seededCode(): string {
  let c = "ECH-";
  for (let i = 0; i < 4; i++) c += ALPHABET[Math.floor(rnd() * ALPHABET.length)];
  if (codes.has(c)) return seededCode();
  codes.add(c);
  return c;
}

/* ======================================================================== */
/* Tables                                                                  */
/* ======================================================================== */

interface Row extends FeedbackRecord {
  tracking_code: string;
  device_hash: string | null;
}

interface MockIssue {
  id: number;
  title: string;
  category: string;
  location_id: number;
  status: IssueStatus;
  urgency: Urgency;
  assignee_id: number | null;
  public_response: string | null;
  reopened_count: number;
  created_at: string;
  resolved_at: string | null;
  events: IssueEvent[];
  votes: Map<string, boolean>;
}

const feedback: Row[] = [];
const issues: MockIssue[] = [];
let aspectId = 1;
let eventId = 1;

const ev = (to: IssueStatus, from: IssueStatus | null, actor: string, at: string, note: string | null = null): IssueEvent => ({
  id: eventId++,
  from_status: from,
  to_status: to,
  actor,
  note,
  created_at: at,
});

function aspect(category: string, sentiment: Sentiment, urgency: Urgency, span: string, issueId: number | null): Aspect {
  return { id: aspectId++, aspect: category, category, sentiment, urgency, evidence_span: span, issue_id: issueId };
}

function overall(aspects: Aspect[]): Sentiment {
  const neg = aspects.some((a) => a.sentiment === "negative");
  const pos = aspects.some((a) => a.sentiment === "positive");
  if (neg && !pos) return "negative";
  if (pos && !neg) return "positive";
  return "neutral";
}

function addRow(p: {
  kind: "text" | "me_too";
  text: string | null;
  location_id: number;
  at: number;
  aspects: Aspect[];
  status?: FeedbackRecord["status"];
  flags?: ModerationFlag[];
  analyzed_by?: FeedbackRecord["analyzed_by"];
  code?: string;
  device_hash?: string | null;
}): Row {
  const row: Row = {
    id: feedback.length + 1,
    kind: p.kind,
    text_redacted: p.text,
    location_id: p.location_id,
    location_name: locName(p.location_id),
    status: p.status ?? "approved",
    overall_sentiment: overall(p.aspects),
    analyzed_by: p.analyzed_by ?? (rnd() < 0.86 ? "llm" : "lexicon"),
    flags: p.flags ?? [],
    created_at: new Date(p.at).toISOString(),
    aspects: p.aspects,
    tracking_code: p.code ?? seededCode(),
    device_hash: p.device_hash ?? null,
  };
  feedback.push(row);
  return row;
}

/* ---- issues and the reports behind them -------------------------------- */

interface IssueSeed {
  id: number;
  title: string;
  category: string;
  location_id: number;
  status: IssueStatus;
  urgency: Urgency;
  assignee_id: number | null;
  public_response: string | null;
  opened: number; // days ago
  resolved?: number; // days ago
  /** [count, from days ago, to days ago] batches of reports */
  batches: [number, number, number][];
  lines: string[];
  events?: (issueCreated: string) => IssueEvent[];
  reopened_count?: number;
  /** Positive asides that sometimes ride along with a complaint */
  asides?: { category: string; span: string }[];
}

const SEEDS: IssueSeed[] = [
  {
    id: 1,
    title: "Wi-Fi dead across Block 3",
    category: "Wi-Fi",
    location_id: 1,
    status: "open",
    urgency: "critical",
    assignee_id: null,
    public_response: null,
    opened: 24,
    batches: [
      [17, 2.9, 0.05], // the spike: last 72 hours
      [13, 24, 3.2],
    ],
    lines: [
      "Wi-Fi in Block 3 has been dead for 3 days",
      "No internet on the 3rd floor of Block 3 again",
      "Block 3 router keeps dropping every ten minutes",
      "Can't upload my assignment, the Wi-Fi in Block 3 is down",
      "Wi-Fi is dead in my room and exams start Monday",
      "Internet in Block 3 hasn't worked since the weekend",
    ],
    asides: [
      { category: "Food", span: "Mess food is good" },
      { category: "Hygiene", span: "the corridors are clean now" },
    ],
  },
  {
    id: 2,
    title: "Dinner served cold after 8 pm",
    category: "Food",
    location_id: 2,
    status: "acknowledged",
    urgency: "high",
    assignee_id: 3,
    public_response: null,
    opened: 18,
    batches: [[21, 18, 0.3]],
    lines: [
      "Dinner was cold again after 8",
      "Food at Mess A is cold by the time the second batch eats",
      "Rice and dal were cold at 8:30 tonight",
      "Late dinner is always cold at Mess A",
    ],
    events: (c) => [ev("open", null, "Echo", c), ev("acknowledged", "open", "Mess manager", ago(7), "Checking the hot-case timings")],
  },
  {
    id: 3,
    title: "Library AC not cooling on 2nd floor",
    category: "Maintenance",
    location_id: 3,
    status: "resolved",
    urgency: "high",
    assignee_id: 4,
    public_response: "Compressor replaced on 24 Sep. 2nd floor holds 23 °C now. Thanks to everyone who flagged it.",
    opened: 12,
    resolved: 3,
    batches: [[18, 12, 3.2]],
    lines: ["Library AC on the 2nd floor isn't cooling", "It's too hot to study on the library 2nd floor", "2nd floor AC is blowing warm air"],
    events: (c) => [
      ev("open", null, "Echo", c),
      ev("acknowledged", "open", "Estate office", ago(11)),
      ev("in_progress", "acknowledged", "Estate office", ago(8), "Technician scheduled"),
      ev("resolved", "in_progress", "Estate office", ago(3), "Compressor replaced"),
    ],
  },
  {
    id: 4,
    title: "Route 12 bus late every morning",
    category: "Transport",
    location_id: 5,
    status: "reopened",
    urgency: "high",
    assignee_id: 5,
    public_response: "Departure moved to 7:40 from 29 Sep.",
    opened: 16,
    batches: [[15, 16, 0.5]],
    lines: ["Route 12 bus was late again this morning", "Missed my 8 am class because route 12 came at 8:10", "Route 12 still leaves late"],
    reopened_count: 1,
    events: (c) => [
      ev("open", null, "Echo", c),
      ev("acknowledged", "open", "Transport desk", ago(14)),
      ev("resolved", "acknowledged", "Transport desk", ago(6), "Departure moved to 7:40"),
      ev("reopened", "resolved", "Reporters", ago(2), "5 of 11 reporters said it isn't fixed"),
    ],
  },
  {
    id: 5,
    title: "Lab 4 systems won't boot",
    category: "Labs",
    location_id: 4,
    status: "in_progress",
    urgency: "high",
    assignee_id: 2,
    public_response: null,
    opened: 5,
    batches: [[11, 5, 0.4]],
    lines: ["Half the PCs in Lab 4 won't boot", "Lab 4 systems are stuck on the boot screen", "Couldn't do my lab exam practice, Lab 4 machines are dead"],
    events: (c) => [
      ev("open", null, "Echo", c),
      ev("acknowledged", "open", "IT services", ago(4)),
      ev("in_progress", "acknowledged", "IT services", ago(2), "Reimaging 30 machines"),
    ],
  },
  {
    id: 6,
    title: "Block 3 washrooms not cleaned on weekends",
    category: "Hygiene",
    location_id: 1,
    status: "open",
    urgency: "normal",
    assignee_id: null,
    public_response: null,
    opened: 8,
    batches: [[9, 8, 0.8]],
    lines: ["Block 3 washrooms weren't cleaned all weekend", "Washrooms on floor 2 of Block 3 smell terrible", "Nobody cleaned the Block 3 bathrooms on Sunday"],
  },
  {
    id: 7,
    title: "Water cooler leaking outside Mess A",
    category: "Maintenance",
    location_id: 2,
    status: "resolved",
    urgency: "normal",
    assignee_id: 4,
    public_response: "Valve replaced and the floor is dry. Report it again here if it comes back.",
    opened: 20,
    resolved: 15,
    batches: [[7, 20, 15.2]],
    lines: ["Water cooler outside Mess A is leaking", "Floor near the Mess A cooler is slippery from the leak"],
  },
  {
    id: 8,
    title: "Plates not washed properly at Mess A",
    category: "Hygiene",
    location_id: 2,
    status: "resolved",
    urgency: "normal",
    assignee_id: 3,
    public_response: "Second dishwasher shift added at lunch. Spot checks twice a day.",
    opened: 24,
    resolved: 19,
    batches: [[26, 24, 19.2]],
    lines: ["Plates at Mess A still have food stuck on them", "Greasy plates again at lunch", "Found a dirty spoon in the Mess A tray"],
  },
  {
    id: 9,
    title: "Library Wi-Fi login page won't load",
    category: "Wi-Fi",
    location_id: 3,
    status: "resolved",
    urgency: "normal",
    assignee_id: 2,
    public_response: "Captive portal certificate renewed. Login works on all floors.",
    opened: 11,
    resolved: 8,
    batches: [[12, 11, 8.2]],
    lines: ["Library Wi-Fi login page never loads", "Can't log in to library Wi-Fi, certificate error"],
  },
  {
    id: 10,
    title: "Street light out on the Block 3 path",
    category: "Maintenance",
    location_id: 1,
    status: "resolved",
    urgency: "normal",
    assignee_id: 4,
    public_response: "Lamp and timer replaced.",
    opened: 6,
    resolved: 1,
    batches: [[6, 6, 1.2]],
    lines: ["Street light on the Block 3 path is out, it's pitch dark", "The path to Block 3 has no light at night"],
  },
];

for (const s of SEEDS) {
  const created = ago(s.opened);
  const team = userRef(s.assignee_id)?.name ?? "Staff";
  const defaultEvents = (): IssueEvent[] => {
    const e = [ev("open", null, "Echo", created)];
    if (s.status === "resolved" && s.resolved !== undefined) {
      e.push(ev("in_progress", "open", team, ago((s.opened + s.resolved) / 2)));
      e.push(ev("resolved", "in_progress", team, ago(s.resolved)));
    }
    return e;
  };
  issues.push({
    id: s.id,
    title: s.title,
    category: s.category,
    location_id: s.location_id,
    status: s.status,
    urgency: s.urgency,
    assignee_id: s.assignee_id,
    public_response: s.public_response,
    reopened_count: s.reopened_count ?? 0,
    created_at: created,
    resolved_at: s.resolved !== undefined && s.status === "resolved" ? ago(s.resolved) : null,
    events: s.events ? s.events(created) : defaultEvents(),
    votes: new Map(),
  });
  for (const [count, from, to] of s.batches) {
    for (let k = 0; k < count; k++) {
      const at = when(from, to);
      if (rnd() < 0.24) {
        // A one-tap "Me too": no text, one negative aspect on the issue
        addRow({ kind: "me_too", text: null, location_id: s.location_id, at, aspects: [aspect(s.category, "negative", s.urgency, "", s.id)] });
        continue;
      }
      const line = pick(s.lines);
      const aside = s.asides && rnd() < 0.25 ? pick(s.asides) : null;
      const text = aside ? `${aside.span[0].toUpperCase()}${aside.span.slice(1)} but ${line[0].toLowerCase()}${line.slice(1)}.` : `${line}.`;
      const aspects = [aspect(s.category, "negative", s.urgency, line, s.id)];
      if (aside) aspects.unshift(aspect(aside.category, "positive", "normal", aside.span, null));
      addRow({ kind: "text", text, location_id: s.location_id, at, aspects });
    }
  }
}

// Kept, with the profanity masked: angry is not abusive
addRow({
  kind: "text",
  text: "The d*** Wi-Fi in Block 3 is dead again.",
  location_id: 1,
  at: when(1.5, 1.2),
  aspects: [aspect("Wi-Fi", "negative", "critical", "Wi-Fi in Block 3 is dead again", 1)],
  flags: ["profanity_masked"],
});

/* ---- everyday feedback that isn't a recurring problem ------------------- */

const EVERYDAY: { loc: number; cat: string; s: Sentiment; t: string }[] = [
  { loc: 2, cat: "Food", s: "positive", t: "Paneer curry at Mess A was great today" },
  { loc: 2, cat: "Food", s: "positive", t: "Breakfast was hot and on time" },
  { loc: 2, cat: "Food", s: "positive", t: "Mess A staff were really helpful tonight" },
  { loc: 2, cat: "Food", s: "neutral", t: "The mess menu is the same every week" },
  { loc: 2, cat: "Food", s: "negative", t: "Rice was undercooked at lunch" },
  { loc: 3, cat: "Library", s: "positive", t: "Library is quiet and clean during exams" },
  { loc: 3, cat: "Library", s: "positive", t: "Extended library hours are a lifesaver" },
  { loc: 3, cat: "Library", s: "neutral", t: "Library could use more charging points" },
  { loc: 3, cat: "Library", s: "negative", t: "Library printer is out of paper again" },
  { loc: 4, cat: "Labs", s: "positive", t: "Lab 2 PCs are much faster after the upgrade" },
  { loc: 4, cat: "Labs", s: "positive", t: "Lab assistants were patient and helpful" },
  { loc: 4, cat: "Labs", s: "negative", t: "Lab 3 projector keeps flickering" },
  { loc: 4, cat: "Labs", s: "neutral", t: "Lab 4 AC is okay I guess" },
  { loc: 5, cat: "Transport", s: "positive", t: "Route 7 bus was on time all week" },
  { loc: 5, cat: "Transport", s: "positive", t: "Driver on route 3 was really polite" },
  { loc: 5, cat: "Transport", s: "neutral", t: "Bus bay needs a timetable board" },
  { loc: 5, cat: "Transport", s: "negative", t: "No shade at the bus bay in the afternoon" },
  { loc: 1, cat: "Hygiene", s: "positive", t: "Block 3 common room is spotless now" },
  { loc: 1, cat: "Maintenance", s: "positive", t: "Hot water is back in Block 3, thank you" },
  { loc: 1, cat: "Maintenance", s: "negative", t: "The Block 3 lift is painfully slow" },
  { loc: 1, cat: "Maintenance", s: "neutral", t: "Laundry timings in Block 3 are fine" },
  { loc: 2, cat: "Hygiene", s: "positive", t: "Mess A tables are cleaned quickly now" },
];
for (let k = 0; k < 262; k++) {
  const e = pick(EVERYDAY);
  const at = when(42, 0.05);
  addRow({ kind: "text", text: `${e.t}.`, location_id: e.loc, at, aspects: [aspect(e.cat, e.s, "normal", e.t, null)] });
}

/* ---- moderation queue ---------------------------------------------------- */

const QUEUE: { loc: number; text: string; flags: ModerationFlag[]; aspects: Aspect[] }[] = [
  { loc: 1, text: "WIN FREE RECHARGE!!! visit [link] now and share with 10 friends", flags: ["spam"], aspects: [] },
  { loc: 3, text: "asdfgh jkl qwerty zzzz", flags: ["gibberish"], aspects: [] },
  { loc: 1, text: "wifi wifi wifi wifi wifi wifi wifi wifi", flags: ["duplicate_flood"], aspects: [] },
  { loc: 4, text: "Who won the cricket match yesterday?", flags: ["off_topic"], aspects: [] },
  {
    loc: 2,
    text: "The mess manager is a useless idiot and the dinner is always cold",
    flags: ["abusive"],
    aspects: [aspect("Food", "negative", "high", "the dinner is always cold", 2)],
  },
  {
    loc: 5,
    text: "Bus 12 late again, the driver is a total clown",
    flags: ["abusive"],
    aspects: [aspect("Transport", "negative", "high", "Bus 12 late again", 4)],
  },
];
for (const q of QUEUE) addRow({ kind: "text", text: q.text, location_id: q.loc, at: when(1.2, 0.05), aspects: q.aspects, status: "pending", flags: q.flags });

/* ---- demo tracking codes -------------------------------------------------- */

// A report on the resolved library issue, handy for showing the verification screen
addRow({
  kind: "text",
  text: "Library AC on the 2nd floor isn't cooling.",
  location_id: 3,
  at: when(11, 10),
  aspects: [aspect("Maintenance", "negative", "high", "Library AC on the 2nd floor isn't cooling", 3)],
  code: "ECH-DEMO",
});
// Backup phones for the live demo: each holds a code linked to the Wi-Fi issue
["ECH-TEAM", "ECH-NIKH", "ECH-AADI"].forEach((code) =>
  addRow({ kind: "me_too", text: null, location_id: 1, at: when(2, 1), aspects: [aspect("Wi-Fi", "negative", "critical", "", 1)], code }),
);
feedback.forEach((f) => codes.add(f.tracking_code));

/* ---- verification votes on resolved issues ------------------------------- */

const seedVotes = (id: number, yes: number, no: number) => {
  const i = issues.find((x) => x.id === id)!;
  for (let k = 0; k < yes; k++) i.votes.set(`SEED-${id}-Y${k}`, true);
  for (let k = 0; k < no; k++) i.votes.set(`SEED-${id}-N${k}`, false);
};
seedVotes(3, 6, 1);
seedVotes(4, 6, 5);
seedVotes(7, 5, 0);
seedVotes(8, 14, 3);
seedVotes(9, 7, 1);
seedVotes(10, 1, 0); // too few votes to count as verified yet

/* ======================================================================== */
/* Derived values                                                          */
/* ======================================================================== */

const URGENCY_X: Record<Urgency, number> = { normal: 1, high: 2, critical: 3 };

function linkedAspects(issueId: number) {
  const out: { row: Row; a: Aspect }[] = [];
  for (const row of feedback) {
    if (row.status !== "approved") continue;
    for (const a of row.aspects) if (a.issue_id === issueId) out.push({ row, a });
  }
  return out;
}

function breakdown(i: MockIssue): Omit<PriorityBreakdown, "rank"> {
  const linked = linkedAspects(i.id);
  const weekAgo = now - 7 * DAY;
  const recent = linked.filter((l) => new Date(l.row.created_at).getTime() >= weekAgo).length;
  const older = linked.length - recent;
  const rw = recent + older * 0.5;
  const n = linked.length ? linked.filter((l) => l.a.sentiment === "negative").length / linked.length : 0;
  const u = URGENCY_X[i.urgency];
  return {
    recent_reports: recent,
    older_reports: older,
    recency_weighted: rw,
    negative_share: n,
    urgency_multiplier: u,
    score: Math.round(rw * n * u * 10) / 10,
  };
}

function tally(i: MockIssue) {
  let fixed = 0;
  let not_fixed = 0;
  i.votes.forEach((v) => (v ? fixed++ : not_fixed++));
  return { fixed, not_fixed };
}

function summary(i: MockIssue): IssueSummary {
  const b = breakdown(i);
  return {
    id: i.id,
    title: i.title,
    category: i.category,
    location_id: i.location_id,
    location_name: locName(i.location_id),
    status: i.status,
    priority_score: b.score,
    report_count: b.recent_reports + b.older_reports,
    negative_share: b.negative_share,
    urgency: i.urgency,
    assignee: userRef(i.assignee_id),
    public_response: i.public_response,
    reopened_count: i.reopened_count,
    created_at: i.created_at,
    resolved_at: i.resolved_at,
  };
}

const ACTIVE: IssueStatus[] = ["open", "acknowledged", "in_progress", "reopened"];

function rankOf(id: number) {
  const active = issues
    .filter((i) => ACTIVE.includes(i.status))
    .map((i) => ({ id: i.id, s: breakdown(i).score }))
    .sort((a, b) => b.s - a.s);
  const idx = active.findIndex((x) => x.id === id);
  return idx === -1 ? 0 : idx + 1;
}

function applyReopenRule(i: MockIssue) {
  if (i.status !== "resolved") return;
  const t = tally(i);
  const total = t.fixed + t.not_fixed;
  if (total >= 3 && t.not_fixed / total >= 0.3) {
    i.events.push(ev("reopened", "resolved", "Reporters", new Date().toISOString(), `${t.not_fixed} of ${total} reporters said it isn't fixed`));
    i.status = "reopened";
    i.resolved_at = null;
    i.reopened_count += 1;
    emit({ type: "issue_status", at: new Date().toISOString(), issue: liveIssue(i) });
  }
}

/* ======================================================================== */
/* Live events (what SSE delivers from the real backend)                   */
/* ======================================================================== */

const listeners = new Set<(e: LiveEvent) => void>();
function emit(e: LiveEvent) {
  listeners.forEach((fn) => fn(structuredClone(e)));
}
const liveIssue = (i: MockIssue) => {
  const s = summary(i);
  return { id: s.id, title: s.title, status: s.status, report_count: s.report_count };
};
const publicRow = (r: Row): FeedbackRecord => {
  const copy: Partial<Row> = { ...r };
  delete copy.tracking_code;
  delete copy.device_hash;
  return copy as FeedbackRecord;
};

/* ======================================================================== */
/* Lexicon analysis (mirrors the backend fallback)                         */
/* ======================================================================== */

const CATEGORY_WORDS: Record<string, string[]> = {
  "Wi-Fi": ["wifi", "wi-fi", "internet", "network", "router", "signal"],
  Food: ["food", "mess", "dinner", "lunch", "breakfast", "meal", "rice", "curry", "taste", "dal"],
  Hygiene: ["washroom", "toilet", "dirty", "clean", "smell", "bathroom", "hygiene", "plates"],
  Transport: ["bus", "route", "driver", "transport", "shuttle"],
  Maintenance: ["ac", "fan", "light", "leak", "water", "cooler", "broken", "repair", "lift"],
  Labs: ["lab", "system", "computer", "pc", "boot", "software", "projector"],
  Library: ["library", "books", "seats", "silence", "reading", "printer"],
};
const NEG = ["dead", "not", "no", "never", "cold", "late", "dirty", "broken", "worst", "bad", "leak", "sick", "slow", "down", "won't", "can't", "stopped", "missed"];
const POS = ["good", "great", "love", "nice", "clean", "fast", "tasty", "helpful", "improved", "thanks", "better", "fixed"];
const URGENT = ["sick", "days", "dead", "unsafe", "danger", "fire", "injury", "exam", "urgent", "week"];
const PROFANITY = ["damn", "shit", "crap", "hell"];
const ABUSE = ["idiot", "stupid", "useless", "clown", "moron"];

export function redact(text: string) {
  return text
    .replace(/[\w.+-]+@[\w-]+\.[\w.]+/g, "[email]")
    .replace(/(?:\+?91[\s-]?)?[6-9]\d{9}\b/g, "[phone]")
    .replace(/\bRA\d{10,13}\b/gi, "[reg no]");
}

function moderate(text: string): { flags: ModerationFlag[]; text: string; pending: boolean } {
  const flags: ModerationFlag[] = [];
  let out = text;
  const lower = text.toLowerCase();
  const words = lower.split(/\s+/).filter(Boolean);
  if (/https?:\/\/|www\.|free recharge|click here|win \w+ now/i.test(text)) flags.push("spam");
  const letters = lower.replace(/[^a-z]/g, "");
  const vowels = letters.replace(/[^aeiou]/g, "").length;
  if (letters.length > 8 && vowels / letters.length < 0.18) flags.push("gibberish");
  if (words.length >= 5 && new Set(words).size / words.length < 0.35) flags.push("duplicate_flood");
  if (ABUSE.some((w) => new RegExp(`\\b${w}\\b`).test(lower))) flags.push("abusive");
  for (const w of PROFANITY) {
    const re = new RegExp(`\\b${w}\\b`, "gi");
    if (re.test(out)) {
      out = out.replace(re, (m) => m[0] + "*".repeat(m.length - 1));
      if (!flags.includes("profanity_masked")) flags.push("profanity_masked");
    }
  }
  const pending = flags.some((f) => f !== "profanity_masked");
  return { flags, text: out, pending };
}

function analyze(text: string, locationId: number): Aspect[] {
  const clauses = text
    .split(/\bbut\b|\bhowever\b|[.;!?]+|,\s*(?:and|also)\b/i)
    .map((s) => s.trim())
    .filter((s) => s.length > 3);
  // "ignore previous instructions ..." clauses carry no aspect
  const cleaned = clauses.filter((c) => !/ignore (all |any )?previous|mark this|instructions/i.test(c));
  const out: Aspect[] = [];
  for (const clause of cleaned.length ? cleaned : [text]) {
    const lower = clause.toLowerCase();
    const category = Object.entries(CATEGORY_WORDS).find(([, ws]) => ws.some((w) => new RegExp(`\\b${w}\\b`).test(lower)))?.[0] ?? "General";
    const neg = NEG.filter((w) => new RegExp(`\\b${w}\\b`).test(lower)).length;
    const pos = POS.filter((w) => new RegExp(`\\b${w}\\b`).test(lower)).length;
    const sentiment: Sentiment = neg > pos ? "negative" : pos > neg ? "positive" : "neutral";
    const urg = URGENT.filter((w) => lower.includes(w)).length;
    const urgency: Urgency = sentiment !== "negative" ? "normal" : urg >= 2 ? "critical" : urg === 1 ? "high" : "normal";
    if (category !== "General" && out.some((a) => a.category === category)) continue;
    const match =
      sentiment === "negative"
        ? issues.find((i) => i.category === category && i.location_id === locationId && i.status !== "resolved")
        : undefined;
    out.push(aspect(category === "General" ? "Other" : category, sentiment, urgency, clause, match?.id ?? null));
    out[out.length - 1].category = category;
  }
  const meaningful = out.filter((a) => !(a.category === "General" && a.sentiment === "neutral"));
  return meaningful.length ? meaningful : out;
}

/** A negative aspect that matched no open issue starts a new one */
function clusterNew(aspects: Aspect[], locationId: number) {
  for (const a of aspects) {
    if (a.sentiment !== "negative" || a.issue_id || a.category === "General") continue;
    const id = Math.max(...issues.map((i) => i.id)) + 1;
    const created = new Date().toISOString();
    const title = a.evidence_span.length > 60 ? `${a.evidence_span.slice(0, 57)}…` : a.evidence_span;
    issues.push({
      id,
      title: title[0].toUpperCase() + title.slice(1),
      category: a.category,
      location_id: locationId,
      status: "open",
      urgency: a.urgency,
      assignee_id: null,
      public_response: null,
      reopened_count: 0,
      created_at: created,
      resolved_at: null,
      events: [ev("open", null, "Echo", created)],
      votes: new Map(),
    });
    a.issue_id = id;
  }
}

/* ======================================================================== */
/* Operations                                                              */
/* ======================================================================== */

const meTooByDevice = new Map<string, string>(); // `${device}:${issue}` -> code
const sessions = new Map<string, User>();

function requireUser(token: string | null): User {
  // Mock tokens look like "mock.<userId>.<random>"; accept them after a reload too
  const u = token ? sessions.get(token) ?? users.find((x) => token.startsWith(`mock.${x.id}.`)) : undefined;
  if (!u) throw new MockError("UNAUTHORIZED", "Your session has ended. Sign in again.");
  return u;
}
function canSee(u: User, i: MockIssue) {
  return u.role === "admin" || i.assignee_id === u.id;
}

export const mock = {
  /* ---------- public ---------- */

  listLocations: () => locations,

  getLocation(slug: string) {
    const l = locations.find((x) => x.slug === slug);
    if (!l) throw new MockError("NOT_FOUND", "We couldn't find that location. Scan the QR code again.");
    return l;
  },

  locationIssues(slug: string): IssueSummary[] {
    const l = mock.getLocation(slug);
    return issues
      .filter((i) => i.location_id === l.id && i.status !== "resolved")
      .map(summary)
      .sort((a, b) => b.report_count - a.report_count)
      .slice(0, 3);
  },

  meToo(issueId: number, deviceId: string): MeTooResult {
    const i = issues.find((x) => x.id === issueId);
    if (!i) throw new MockError("NOT_FOUND", "That issue no longer exists.");
    const key = `${deviceId}:${issueId}`;
    const existing = meTooByDevice.get(key);
    if (existing) throw new MockError("ALREADY_REPORTED", "You've already added your voice to this one.", { tracking_code: existing });
    const code = newCode();
    const row = addRow({
      kind: "me_too",
      text: null,
      location_id: i.location_id,
      at: Date.now(),
      aspects: [aspect(i.category, "negative", i.urgency, "", i.id)],
      code,
      device_hash: deviceId.slice(0, 8),
    });
    meTooByDevice.set(key, code);
    emit({ type: "me_too", at: row.created_at, feedback: publicRow(row), issue: liveIssue(i) });
    return { tracking_code: code, report_count: summary(i).report_count };
  },

  submit(input: SubmitFeedbackInput): SubmitFeedbackResult {
    const raw = input.text.trim();
    if (input.website) throw new MockError("REJECTED", "Submission rejected.");
    if (raw.length < 10) throw new MockError("VALIDATION_ERROR", "Feedback must be at least 10 characters", { text: "too_short" });
    if (raw.length > 1000) throw new MockError("VALIDATION_ERROR", "Feedback must be at most 1000 characters", { text: "too_long" });
    const loc = mock.getLocation(input.location_slug);
    const mod = moderate(redact(raw));
    const aspects = mod.pending ? [] : analyze(mod.text, loc.id);
    if (!mod.pending) clusterNew(aspects, loc.id);
    const row = addRow({
      kind: "text",
      text: mod.text,
      location_id: loc.id,
      at: Date.now(),
      aspects,
      status: mod.pending ? "pending" : "approved",
      flags: mod.flags,
      analyzed_by: "lexicon",
      code: newCode(),
    });
    emit({ type: mod.pending ? "moderation" : "feedback", at: row.created_at, feedback: publicRow(row) });
    return { tracking_code: row.tracking_code, text_redacted: row.text_redacted!, analyzed_by: row.analyzed_by, aspects };
  },

  track(code: string): TrackResult {
    const row = feedback.find((f) => f.tracking_code === code.trim().toUpperCase());
    if (!row) throw new MockError("NOT_FOUND", "No report matches that code. Check the letters and try again.");
    const issueIds = [...new Set(row.aspects.map((a) => a.issue_id).filter((x): x is number => x != null))];
    return {
      tracking_code: row.tracking_code,
      kind: row.kind,
      submitted_at: row.created_at,
      location_name: row.location_name,
      moderation_status: row.status,
      aspects: row.aspects.filter((a) => a.evidence_span),
      issues: issueIds
        .map((id) => issues.find((i) => i.id === id)!)
        .map((i) => {
          const vote = i.votes.get(row.tracking_code);
          const s = summary(i);
          return {
            id: i.id,
            title: i.title,
            category: i.category,
            location_name: s.location_name,
            status: i.status,
            report_count: s.report_count,
            public_response: i.public_response,
            timeline: i.events,
            can_verify: i.status === "resolved" && vote === undefined,
            my_vote: vote ?? null,
            verification: tally(i),
          };
        }),
    };
  },

  verify(code: string, issueId: number, fixed: boolean) {
    const row = feedback.find((f) => f.tracking_code === code);
    const i = issues.find((x) => x.id === issueId);
    if (!row || !i || !row.aspects.some((a) => a.issue_id === issueId))
      throw new MockError("FORBIDDEN", "Only people who reported this issue can vote on it.");
    if (i.status !== "resolved") throw new MockError("CONFLICT", "This issue isn't marked resolved yet.");
    if (i.votes.has(code)) throw new MockError("ALREADY_VOTED", "You've already voted on this issue.");
    i.votes.set(code, fixed);
    applyReopenRule(i);
    return mock.track(code);
  },

  /** Dev helper: votes from other reporters, as if their phones answered */
  addSeedVotes(issueId: number, votes: boolean[]) {
    const i = issues.find((x) => x.id === issueId)!;
    votes.forEach((v) => i.votes.set(`OTHER-${Math.random().toString(36).slice(2, 8)}`, v));
    applyReopenRule(i);
  },

  /** Dev helper used by the tracking page's staff bar */
  setStatus(issueId: number, to: IssueStatus, actor: string, publicResponse?: string) {
    const i = issues.find((x) => x.id === issueId)!;
    i.events.push(ev(to, i.status, actor, new Date().toISOString(), publicResponse ?? null));
    i.status = to;
    if (publicResponse) i.public_response = publicResponse;
    if (to === "resolved") {
      i.resolved_at = new Date().toISOString();
      i.votes.clear();
    }
    emit({ type: "issue_status", at: new Date().toISOString(), issue: liveIssue(i) });
    return summary(i);
  },

  publicStats(): PublicStats {
    const resolved = issues.filter((i) => i.status === "resolved");
    const verified = resolved.filter((i) => {
      const t = tally(i);
      const n = t.fixed + t.not_fixed;
      return n >= 3 && t.not_fixed / n < 0.3;
    });
    const approved = feedback.filter((f) => f.status === "approved");
    const days = resolved.map((i) => (new Date(i.resolved_at!).getTime() - new Date(i.created_at).getTime()) / DAY);
    return {
      people_heard: approved.length,
      total_feedback: feedback.length,
      response_rate: issues.filter((i) => i.public_response).length / issues.length,
      avg_days_to_resolve: days.length ? Math.round((days.reduce((a, b) => a + b, 0) / days.length) * 10) / 10 : 0,
      verified_fix_rate: resolved.length ? verified.length / resolved.length : 0,
      resolved_share: resolved.length / issues.length,
    };
  },

  publicIssues(): PublicIssue[] {
    return issues.map((i) => {
      const s = summary(i);
      return {
        id: i.id,
        title: i.title,
        category: i.category,
        location_name: s.location_name,
        status: i.status,
        report_count: s.report_count,
        public_response: i.public_response,
        created_at: i.created_at,
        resolved_at: i.resolved_at,
        verification: tally(i),
      };
    });
  },

  ticker() {
    return feedback
      .filter((f) => f.kind === "text" && f.status === "approved" && f.overall_sentiment !== "neutral")
      .sort((a, b) => b.created_at.localeCompare(a.created_at))
      .slice(0, 8)
      .map((f) => ({ text: f.text_redacted!.replace(/\.$/, ""), sentiment: f.overall_sentiment, at: f.created_at }));
  },

  /* ---------- staff console ---------- */

  login(email: string, password: string): LoginResult {
    const u = users.find((x) => x.email === email.trim().toLowerCase());
    if (!u || password !== DEMO_PASSWORD) throw new MockError("INVALID_CREDENTIALS", "Email or password is incorrect.");
    const token = `mock.${u.id}.${Math.random().toString(36).slice(2)}`;
    sessions.set(token, u);
    return { access_token: token, user: u };
  },

  me(token: string | null): User {
    return requireUser(token);
  },

  staff: (token: string | null) => {
    requireUser(token);
    return users.filter((u) => u.role === "staff");
  },

  listIssues(token: string | null, q: IssueQuery = {}): IssueSummary[] {
    const u = requireUser(token);
    return issues
      .filter((i) => canSee(u, i))
      .filter((i) => (q.status === "active" ? ACTIVE.includes(i.status) : !q.status || i.status === q.status))
      .filter((i) => !q.category || i.category === q.category)
      .filter((i) => q.assignee_id === undefined || i.assignee_id === q.assignee_id)
      .map(summary)
      .sort((a, b) => {
        const act = Number(ACTIVE.includes(b.status)) - Number(ACTIVE.includes(a.status));
        return act || b.priority_score - a.priority_score;
      });
  },

  getIssue(token: string | null, id: number): IssueDetail {
    const u = requireUser(token);
    const i = issues.find((x) => x.id === id);
    if (!i || !canSee(u, i)) throw new MockError("NOT_FOUND", "That issue doesn't exist or isn't assigned to you.");
    const evidence: EvidenceItem[] = linkedAspects(i.id)
      .sort((a, b) => b.row.created_at.localeCompare(a.row.created_at))
      .slice(0, 40)
      .map(({ row, a }) => ({
        feedback_id: row.id,
        kind: row.kind,
        text_redacted: row.text_redacted,
        evidence_span: a.evidence_span || null,
        sentiment: a.sentiment,
        analyzed_by: row.analyzed_by,
        created_at: row.created_at,
      }));
    return { ...summary(i), breakdown: { ...breakdown(i), rank: rankOf(i.id) }, events: i.events, evidence, verification: tally(i) };
  },

  updateIssue(token: string | null, id: number, patch: IssueUpdate): IssueDetail {
    const u = requireUser(token);
    const i = issues.find((x) => x.id === id);
    if (!i || !canSee(u, i)) throw new MockError("NOT_FOUND", "That issue doesn't exist or isn't assigned to you.");
    if (patch.assignee_id !== undefined) {
      if (u.role !== "admin") throw new MockError("FORBIDDEN", "Only admins can assign issues.");
      if (patch.assignee_id !== null && !users.some((x) => x.id === patch.assignee_id && x.role === "staff"))
        throw new MockError("VALIDATION_ERROR", "Pick a staff team to assign.", { assignee_id: "invalid" });
      if (patch.assignee_id !== i.assignee_id) {
        i.assignee_id = patch.assignee_id;
        const who = userRef(patch.assignee_id)?.name ?? "nobody";
        i.events.push(ev(i.status, i.status, u.name, new Date().toISOString(), `Assigned to ${who}`));
      }
    }
    if (patch.title !== undefined) {
      if (u.role !== "admin") throw new MockError("FORBIDDEN", "Only admins can rename issues.");
      const t = patch.title.trim();
      if (t.length < 4 || t.length > 90) throw new MockError("VALIDATION_ERROR", "Titles need 4 to 90 characters.", { title: "length" });
      i.title = t;
    }
    if (patch.public_response !== undefined) {
      const r = patch.public_response.trim();
      if (r.length > 500) throw new MockError("VALIDATION_ERROR", "Keep the public response under 500 characters.", { public_response: "too_long" });
      i.public_response = r || null;
    }
    if (patch.status && patch.status !== i.status) {
      const order: IssueStatus[] = ["open", "acknowledged", "in_progress", "resolved"];
      const from = i.status === "reopened" ? 1 : order.indexOf(i.status);
      const to = order.indexOf(patch.status);
      if (patch.status === "reopened" || to === -1 || to <= from)
        throw new MockError("CONFLICT", "Issues only move forward. Reporters reopen them by voting.");
      if (patch.status === "resolved" && !i.public_response)
        throw new MockError("VALIDATION_ERROR", "Write a public response before resolving. Reporters will see it.", { public_response: "required" });
      i.events.push(ev(patch.status, i.status, u.name, new Date().toISOString(), patch.status === "resolved" ? i.public_response : null));
      i.status = patch.status;
      if (patch.status === "resolved") {
        i.resolved_at = new Date().toISOString();
        i.votes.clear();
      }
      emit({ type: "issue_status", at: new Date().toISOString(), issue: liveIssue(i) });
    }
    return mock.getIssue(token, id);
  },

  searchFeedback(token: string | null, q: FeedbackQuery): Page<FeedbackRecord> {
    requireUser(token);
    const terms = (q.q ?? "").toLowerCase().split(/\s+/).filter(Boolean);
    const since = q.days ? now - q.days * DAY : 0;
    const items = feedback
      .filter((f) => f.status === (q.status ?? "approved")) // pending items live in the moderation queue
      .filter((f) => !q.location_id || f.location_id === q.location_id)
      .filter((f) => !since || new Date(f.created_at).getTime() >= since)
      .filter((f) => !q.category || f.aspects.some((a) => a.category === q.category))
      .filter((f) => !q.sentiment || f.aspects.some((a) => a.sentiment === q.sentiment && (!q.category || a.category === q.category)))
      .filter((f) => !terms.length || (f.text_redacted && terms.every((t) => f.text_redacted!.toLowerCase().includes(t))))
      .sort((a, b) => b.created_at.localeCompare(a.created_at));
    const size = q.page_size ?? 20;
    const page = q.page ?? 1;
    return { items: items.slice((page - 1) * size, page * size).map(publicRow), total: items.length, page, page_size: size };
  },

  moderationQueue(token: string | null): FeedbackRecord[] {
    const u = requireUser(token);
    if (u.role !== "admin") throw new MockError("FORBIDDEN", "Only admins can moderate.");
    return feedback.filter((f) => f.status === "pending").sort((a, b) => b.created_at.localeCompare(a.created_at)).map(publicRow);
  },

  moderate(token: string | null, id: number, action: "approve" | "reject" | "redact", text?: string): FeedbackRecord {
    const u = requireUser(token);
    if (u.role !== "admin") throw new MockError("FORBIDDEN", "Only admins can moderate.");
    const f = feedback.find((x) => x.id === id);
    if (!f || f.status !== "pending") throw new MockError("NOT_FOUND", "That item has already been handled.");
    if (action === "reject") f.status = "rejected";
    else {
      if (action === "redact") {
        const t = (text ?? "").trim();
        if (t.length < 10) throw new MockError("VALIDATION_ERROR", "The redacted text needs at least 10 characters.", { text: "too_short" });
        f.text_redacted = t;
      }
      f.status = "approved";
      if (!f.aspects.length && f.text_redacted) {
        f.aspects = analyze(f.text_redacted, f.location_id);
        clusterNew(f.aspects, f.location_id);
      }
      f.overall_sentiment = overall(f.aspects);
      emit({ type: "feedback", at: new Date().toISOString(), feedback: publicRow(f) });
    }
    return publicRow(f);
  },

  analytics(token: string | null, days = 42): AnalyticsSummary {
    requireUser(token);
    const since = now - days * DAY;
    const rows = feedback.filter((f) => f.status === "approved" && new Date(f.created_at).getTime() >= since);
    const byDay = new Map<string, { positive: number; neutral: number; negative: number }>();
    for (let d = days - 1; d >= 0; d--) byDay.set(new Date(now - d * DAY).toISOString().slice(0, 10), { positive: 0, neutral: 0, negative: 0 });
    const topic = new Map<string, { positive: number; negative: number }>(CATEGORIES.map((c) => [c, { positive: 0, negative: 0 }]));
    const heat = locations.map(() => CATEGORIES.map(() => 0));
    for (const f of rows) {
      const day = byDay.get(f.created_at.slice(0, 10));
      for (const a of f.aspects) {
        if (day) day[a.sentiment] += 1;
        const t = topic.get(a.category);
        if (t && a.sentiment !== "neutral") t[a.sentiment] += 1;
        const ci = CATEGORIES.indexOf(a.category);
        if (a.sentiment === "negative" && ci !== -1) heat[f.location_id - 1][ci] += 1;
      }
    }
    const statuses: IssueStatus[] = ["open", "acknowledged", "in_progress", "resolved", "reopened"];
    const resolved = issues.filter((i) => i.resolved_at);
    const avg = resolved.length
      ? resolved.reduce((s, i) => s + (new Date(i.resolved_at!).getTime() - new Date(i.created_at).getTime()) / DAY, 0) / resolved.length
      : 0;
    const allAspects = rows.flatMap((f) => f.aspects);
    return {
      sentiment_over_time: [...byDay.entries()].map(([date, v]) => ({ date, ...v })),
      topic_sentiment: [...topic.entries()].map(([t, v]) => ({ topic: t, ...v })).sort((a, b) => b.negative + b.positive - (a.negative + a.positive)),
      heatmap: { locations: locations.map((l) => l.name), categories: CATEGORIES, values: heat },
      pipeline: statuses.map((s) => ({ status: s, count: issues.filter((i) => i.status === s).length })),
      avg_days_to_resolve: Math.round(avg * 10) / 10,
      totals: {
        feedback: rows.length,
        negative_share: allAspects.length ? allAspects.filter((a) => a.sentiment === "negative").length / allAspects.length : 0,
        pending_moderation: feedback.filter((f) => f.status === "pending").length,
        active_issues: issues.filter((i) => ACTIVE.includes(i.status)).length,
      },
    };
  },

  /** Spike = negative aspects in the last 72 h vs the average 72 h window of the 28 days before */
  alerts(): { spikes: SpikeAlert[]; trends: Trend[] } {
    const t72 = now - 3 * DAY;
    const t28 = t72 - 28 * DAY;
    const counts = new Map<string, { cur: number; base: number; cat: string; loc: number }>();
    for (const f of feedback) {
      if (f.status !== "approved") continue;
      const t = new Date(f.created_at).getTime();
      for (const a of f.aspects) {
        if (a.sentiment !== "negative" || !CATEGORIES.includes(a.category)) continue;
        const key = `${a.category}|${f.location_id}`;
        const c = counts.get(key) ?? { cur: 0, base: 0, cat: a.category, loc: f.location_id };
        if (t >= t72) c.cur++;
        else if (t >= t28) c.base++;
        counts.set(key, c);
      }
    }
    const spikes = [...counts.values()]
      .map((c) => {
        const baseline = Math.round((c.base / (28 / 3)) * 10) / 10;
        return { category: c.cat, location_name: locName(c.loc), current: c.cur, baseline, ratio: Math.round((c.cur / Math.max(baseline, 1)) * 10) / 10 };
      })
      .filter((s) => s.ratio >= 2 && s.current >= 5)
      .sort((a, b) => b.ratio - a.ratio);

    const w1 = now - 7 * DAY;
    const w2 = now - 14 * DAY;
    const trends: Trend[] = CATEGORIES.map((cat) => {
      let a = 0;
      let b = 0;
      for (const f of feedback) {
        if (f.status !== "approved") continue;
        const t = new Date(f.created_at).getTime();
        const n = f.aspects.filter((x) => x.category === cat && x.sentiment === "negative").length;
        if (t >= w1) a += n;
        else if (t >= w2) b += n;
      }
      return { category: cat, change_pct: b ? Math.round(((a - b) / b) * 100) : a ? 100 : 0, this_week: a, last_week: b };
    })
      .filter((t) => t.this_week !== t.last_week)
      .sort((x, y) => Math.abs(y.this_week - y.last_week) - Math.abs(x.this_week - x.last_week));
    return { spikes, trends };
  },

  subscribe(fn: (e: LiveEvent) => void) {
    listeners.add(fn);
    return () => listeners.delete(fn);
  },

  /** Recent approved text feedback for the live feed's first paint */
  recentFeed(token: string | null, n = 8): FeedbackRecord[] {
    requireUser(token);
    return feedback
      .filter((f) => f.status === "approved")
      .sort((a, b) => b.created_at.localeCompare(a.created_at))
      .slice(0, n)
      .map(publicRow);
  },
};
