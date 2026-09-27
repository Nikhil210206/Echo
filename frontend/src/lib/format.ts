import { CATEGORIES as MOCK_CATEGORIES } from "@/mocks/store";
import { USE_MOCKS } from "./api";
import type { IssueStatus, Sentiment, Urgency } from "./types";

export const STATUS_LABEL: Record<IssueStatus, string> = {
  open: "Open",
  acknowledged: "Acknowledged",
  in_progress: "In progress",
  resolved: "Resolved",
  reopened: "Reopened",
};

export const STATUS_ORDER: IssueStatus[] = ["open", "acknowledged", "in_progress", "resolved"];

export const SENTIMENT_LABEL: Record<Sentiment, string> = {
  positive: "Positive",
  neutral: "Neutral",
  negative: "Negative",
};

// The backend sends lowercase category keys ("infrastructure"); mock data already uses display names
const CATEGORY_LABEL: Record<string, string> = {
  mess: "Mess",
  hostel: "Hostel",
  infrastructure: "Infrastructure",
  transport: "Transport",
  library: "Library",
  academics: "Academics",
  general: "General",
};

export const categoryLabel = (c?: string | null) => (c ? (CATEGORY_LABEL[c] ?? c) : "");

/** Filter options: the raw values the API filters on. Render them with categoryLabel. */
export const CATEGORIES: string[] = USE_MOCKS ? MOCK_CATEGORIES : Object.keys(CATEGORY_LABEL);

export const URGENCY_LABEL: Record<Urgency, string> = {
  normal: "Normal",
  high: "High urgency",
  critical: "Critical",
};

export function timeAgo(iso: string) {
  const s = Math.max(1, Math.round((Date.now() - new Date(iso).getTime()) / 1000));
  if (s < 60) return "just now";
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h} h ago`;
  const d = Math.round(h / 24);
  return d === 1 ? "yesterday" : `${d} days ago`;
}

export function daysBetween(a: string, b: string) {
  return Math.max(0, (new Date(b).getTime() - new Date(a).getTime()) / 86_400_000);
}

export const pct = (x: number) => `${Math.round(x * 100)}%`;
