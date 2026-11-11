import { v } from "convex/values";

export const AUTOMATION_KINDS = [
  "notification",
  "reminder",
  "workflow_error",
] as const;

export const AUTOMATION_STATUSES = [
  "pending",
  "accepted",
  "sent",
  "failed",
] as const;

export type AutomationStatus = (typeof AUTOMATION_STATUSES)[number];

export const NOTIFICATION_EVENTS = [
  "request.created",
  "request.approved",
  "request.declined",
  "request.auto_declined",
  "request.cancelled",
  "request.returned",
] as const;

export type NotificationEvent = (typeof NOTIFICATION_EVENTS)[number];

export const TOOL_REMOVED_EVENT = "tool.removed";

export const REMINDER_EVENT = "reminder.overdue";

export const vAutomationKind = v.union(
  ...AUTOMATION_KINDS.map((k) => v.literal(k)),
);

export const vAutomationStatus = v.union(
  ...AUTOMATION_STATUSES.map((s) => v.literal(s)),
);

export const STUCK_AFTER_MS = 30 * 60_000;

export const WRITE_BACK_STATUSES = ["sent", "failed"] as const;

export type WriteBackStatus = (typeof WRITE_BACK_STATUSES)[number];

export const vWriteBackStatus = v.union(
  ...WRITE_BACK_STATUSES.map((s) => v.literal(s)),
);

export function writeBackError(status: WriteBackStatus, error?: string) {
  return status === "failed"
    ? sanitiseError(error ?? "n8n could not send the email")
    : undefined;
}

const EMAIL_RE = /[^\s@<>"']+@[^\s@<>"']+/g;
const URL_RE = /\b[a-z][a-z0-9+.-]*:\/\/[^\s"'<>]+/gi;
const IPV6_BRACKETED_RE = /\[[0-9a-f:.]*:[0-9a-f:.]*\](?::\d+)?/gi;
const IPV6_RE = /(?<![\w:])(?=[0-9a-f:.]*::)(?:[0-9a-f]{0,4}:){2,}[0-9a-f.]*/gi;
const IPV4_RE = /\b\d{1,3}(?:\.\d{1,3}){3}(?::\d+)?\b/g;
const HOST_PORT_RE =
  /\b(?=[a-z0-9.-]*[a-z])[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?:\d{2,5}\b/gi;
// DNS failures name the host right after the code.
const DNS_FAILURE_RE = /\b(ENOTFOUND|EAI_AGAIN)\s+[^\s,;)]+/g;
const MAX_ERROR = 200;

// lastError is shown to Members and Admins, so it never carries addresses,
// internal hosts or long dumps. Hostnames are only recognised next to a port or
// a DNS error code, so dotted names in code errors survive.
export function sanitiseError(error: string): string {
  return error
    .replace(URL_RE, "[url]")
    .replace(EMAIL_RE, "[email]")
    .replace(IPV6_BRACKETED_RE, "[host]")
    .replace(IPV6_RE, "[host]")
    .replace(IPV4_RE, "[host]")
    .replace(HOST_PORT_RE, "[host]")
    .replace(DNS_FAILURE_RE, "$1 [host]")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, MAX_ERROR);
}
