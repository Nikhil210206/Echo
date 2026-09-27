// Shapes mirror the backend's Pydantic schemas (snake_case), so the mock
// client and the real API are interchangeable. Update here when the contract changes.

export type Sentiment = "positive" | "neutral" | "negative";
export type Urgency = "normal" | "high" | "critical";
export type IssueStatus = "open" | "acknowledged" | "in_progress" | "resolved" | "reopened";
export type ModerationStatus = "pending" | "approved" | "rejected";
export type AnalyzedBy = "llm" | "lexicon";

export interface Location {
  id: number;
  name: string;
  slug: string;
  zone: string;
}

export interface Aspect {
  id: number;
  aspect: string;
  category: string;
  sentiment: Sentiment;
  urgency: Urgency;
  evidence_span: string;
  issue_id: number | null;
}

export interface IssueSummary {
  id: number;
  title: string;
  category: string;
  location_id: number;
  location_name: string;
  status: IssueStatus;
  priority_score: number;
  report_count: number;
  negative_share: number;
  urgency: Urgency;
  assignee: { id: number; name: string } | null;
  public_response: string | null;
  reopened_count: number;
  created_at: string;
  resolved_at: string | null;
}

export interface IssueEvent {
  id: number;
  from_status: IssueStatus | null;
  to_status: IssueStatus;
  actor: string;
  note: string | null;
  created_at: string;
}

export interface SubmitFeedbackInput {
  text: string;
  location_slug: string;
  /** Honeypot. Real people never see or fill this. */
  website?: string;
}

export interface SubmitFeedbackResult {
  tracking_code: string;
  text_redacted: string;
  analyzed_by: AnalyzedBy;
  aspects: Aspect[];
}

export interface MeTooResult {
  tracking_code: string;
  report_count: number;
}

export interface TrackedIssue {
  id: number;
  title: string;
  category: string;
  location_name: string;
  status: IssueStatus;
  report_count: number;
  public_response: string | null;
  timeline: IssueEvent[];
  /** True when the issue is resolved and this code hasn't voted yet */
  can_verify: boolean;
  my_vote: boolean | null;
  verification: { fixed: number; not_fixed: number };
}

export interface TrackResult {
  tracking_code: string;
  kind: "text" | "me_too";
  submitted_at: string;
  location_name: string;
  moderation_status: ModerationStatus;
  aspects: Aspect[];
  issues: TrackedIssue[];
}

export interface PublicStats {
  people_heard: number;
  total_feedback: number;
  response_rate: number;
  avg_days_to_resolve: number;
  verified_fix_rate: number;
  resolved_share: number;
}

export interface PublicIssue {
  id: number;
  title: string;
  category: string;
  location_name: string;
  status: IssueStatus;
  report_count: number;
  public_response: string | null;
  created_at: string;
  resolved_at: string | null;
  verification: { fixed: number; not_fixed: number };
}

export interface SpikeAlert {
  category: string;
  location_name: string;
  current: number;
  baseline: number;
  ratio: number;
}

export interface Trend {
  category: string;
  change_pct: number;
  this_week: number;
  last_week: number;
}

export interface ApiErrorBody {
  error: { code: string; message: string; fields?: Record<string, string> };
}

/* ---------- Staff console -------------------------------------------- */

export type Role = "admin" | "staff";

export interface User {
  id: number;
  name: string;
  email: string;
  role: Role;
  team: string | null;
}

export interface LoginResult {
  access_token: string;
  user: User;
}

export type ModerationFlag = "spam" | "gibberish" | "duplicate_flood" | "off_topic" | "abusive" | "profanity_masked";

export interface FeedbackRecord {
  id: number;
  kind: "text" | "me_too";
  text_redacted: string | null;
  location_id: number;
  location_name: string;
  status: ModerationStatus;
  overall_sentiment: Sentiment;
  analyzed_by: AnalyzedBy;
  flags: ModerationFlag[];
  created_at: string;
  aspects: Aspect[];
}

export interface FeedbackQuery {
  q?: string;
  sentiment?: Sentiment;
  category?: string;
  location_id?: number;
  status?: ModerationStatus;
  /** days back from now */
  days?: number;
  page?: number;
  page_size?: number;
}

export interface Page<T> {
  items: T[];
  total: number;
  page: number;
  page_size: number;
}

export interface PriorityBreakdown {
  recent_reports: number;
  older_reports: number;
  recency_weighted: number;
  negative_share: number;
  urgency_multiplier: number;
  score: number;
  rank: number;
}

export interface EvidenceItem {
  feedback_id: number;
  kind: "text" | "me_too";
  text_redacted: string | null;
  evidence_span: string | null;
  sentiment: Sentiment;
  analyzed_by: AnalyzedBy;
  created_at: string;
}

export interface IssueDetail extends IssueSummary {
  breakdown: PriorityBreakdown;
  events: IssueEvent[];
  evidence: EvidenceItem[];
  verification: { fixed: number; not_fixed: number };
}

export interface IssueQuery {
  status?: IssueStatus | "active";
  category?: string;
  assignee_id?: number;
}

export interface IssueUpdate {
  status?: IssueStatus;
  assignee_id?: number | null;
  public_response?: string;
  title?: string;
}

export interface AnalyticsSummary {
  sentiment_over_time: { date: string; positive: number; neutral: number; negative: number }[];
  topic_sentiment: { topic: string; positive: number; negative: number }[];
  heatmap: { locations: string[]; categories: string[]; values: number[][] };
  pipeline: { status: IssueStatus; count: number }[];
  avg_days_to_resolve: number;
  totals: { feedback: number; negative_share: number; pending_moderation: number; active_issues: number };
}

export interface LiveEvent {
  type: "feedback" | "me_too" | "issue_status" | "moderation";
  at: string;
  feedback?: FeedbackRecord;
  issue?: { id: number; title: string; status: IssueStatus; report_count: number };
}
