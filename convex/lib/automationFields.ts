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

export const vAutomationKind = v.union(
  ...AUTOMATION_KINDS.map((k) => v.literal(k)),
);

export const vAutomationStatus = v.union(
  ...AUTOMATION_STATUSES.map((s) => v.literal(s)),
);

const EMAIL_RE = /[^\s@<>"']+@[^\s@<>"']+/g;
const MAX_ERROR = 200;

// lastError is shown to Members and Admins, so it never carries addresses or long dumps.
export function sanitiseError(error: string): string {
  return error
    .replace(EMAIL_RE, "[email]")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, MAX_ERROR);
}
