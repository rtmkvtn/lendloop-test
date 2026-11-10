import { v } from "convex/values";
import type { Doc } from "../_generated/dataModel";

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

export const vAutomationKind = v.union(
  ...AUTOMATION_KINDS.map((k) => v.literal(k)),
);

export const vAutomationStatus = v.union(
  ...AUTOMATION_STATUSES.map((s) => v.literal(s)),
);

export const STUCK_AFTER_MS = 30 * 60_000;

// Reminders have no Convex-side delivery, so a retried one waits as pending
// for n8n's write-back; Notifications wait as accepted.
export function isStuck(
  event: Pick<Doc<"automationEvents">, "kind" | "status" | "updatedAt">,
  now: number = Date.now(),
) {
  const waiting =
    event.status === "accepted" ||
    (event.kind === "reminder" && event.status === "pending");
  return waiting && now - event.updatedAt > STUCK_AFTER_MS;
}

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
