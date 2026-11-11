import { internal } from "../_generated/api";
import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";
import { type NotificationEvent, TOOL_REMOVED_EVENT } from "./automationFields";
import { REMINDER_EVENT } from "./reminders";

type EmailEvent = NotificationEvent | typeof TOOL_REMOVED_EVENT;
type Audience = "lender" | "borrower";

// Every Notification email, keyed by event. n8n's Compose node in
// notify.json holds the email copy under the same keys (pinned by a test).
const EMAILS: Record<
  EmailEvent,
  { audience: Audience; kind: string; history?: string }
> = {
  "request.created": { audience: "lender", kind: "Request" },
  "request.cancelled": {
    audience: "lender",
    kind: "Cancellation",
    history: "Cancelled",
  },
  "request.approved": {
    audience: "borrower",
    kind: "Approval",
    history: "Approved",
  },
  "request.declined": {
    audience: "borrower",
    kind: "Decline",
    history: "Declined",
  },
  "request.auto_declined": {
    audience: "borrower",
    kind: "Decline",
    history: "Declined automatically: the Tool was removed",
  },
  "request.returned": {
    audience: "borrower",
    kind: "Return",
    history: "Marked returned",
  },
  [TOOL_REMOVED_EVENT]: { audience: "lender", kind: "Removal" },
};

export const EMAIL_EVENTS = Object.keys(EMAILS) as EmailEvent[];

const emailOf = (event: string) =>
  event in EMAILS ? EMAILS[event as EmailEvent] : null;

function audienceOf(event: NotificationEvent): Audience {
  return EMAILS[event].audience;
}

export function recipientOf(
  request: Pick<Doc<"requests">, "lenderId" | "borrowerId">,
  event: NotificationEvent,
) {
  return audienceOf(event) === "lender" ? request.lenderId : request.borrowerId;
}

// Audit actions on a Request read as its status history.
export function historyLabelOf(action: string) {
  return emailOf(action)?.history ?? action;
}

export function deliveryIdOf(event: Doc<"automationEvents">) {
  return `${event._id}#${event.retryGeneration ?? 0}`;
}

// The transactional outbox: the event row and its delivery job commit together
// with the Request change, or not at all.
export async function queueNotification(
  ctx: MutationCtx,
  request: Pick<Doc<"requests">, "_id" | "lenderId" | "borrowerId">,
  event: NotificationEvent,
) {
  return await enqueue(ctx, {
    idempotencyKey: `notify:${request._id}:${event}`,
    requestId: request._id,
    event,
    recipientId: recipientOf(request, event),
  });
}

export async function queueToolRemovedNotification(
  ctx: MutationCtx,
  tool: Pick<Doc<"tools">, "_id" | "ownerId">,
) {
  return await enqueue(ctx, {
    idempotencyKey: `notify:${tool._id}:${TOOL_REMOVED_EVENT}`,
    toolId: tool._id,
    event: TOOL_REMOVED_EVENT,
    recipientId: tool.ownerId,
  });
}

async function enqueue(
  ctx: MutationCtx,
  row: {
    idempotencyKey: string;
    requestId?: Id<"requests">;
    toolId?: Id<"tools">;
    event: string;
    recipientId: Id<"users">;
  },
) {
  const { idempotencyKey } = row;
  const existing = await ctx.db
    .query("automationEvents")
    .withIndex("by_idempotency_key", (q) =>
      q.eq("idempotencyKey", idempotencyKey),
    )
    .first();
  if (existing) return existing._id;

  const eventId = await ctx.db.insert("automationEvents", {
    ...row,
    kind: "notification",
    status: "pending",
    attempts: 0,
    updatedAt: Date.now(),
  });
  await ctx.scheduler.runAfter(0, internal.notifications.deliver, { eventId });
  return eventId;
}

export function subjectOf(event: Pick<Doc<"automationEvents">, "event">) {
  if (event.event === REMINDER_EVENT) return "Reminder";
  const email = emailOf(event.event);
  return email ? `${email.kind} email to ${email.audience}` : "Email";
}

export function activityOf(event: Doc<"automationEvents">) {
  const subject = subjectOf(event);
  const retrying = event.status === "pending" && event.attempts > 0;
  const phrase = retrying
    ? "failed"
    : {
        pending: "queued",
        accepted: "handed to n8n",
        sent: "sent",
        failed: "failed",
      }[event.status];
  return {
    label: `${subject} ${phrase}`,
    at: event.updatedAt,
    failed: retrying || event.status === "failed",
    // Shown after the time, so it reads "failed 2 days ago · retrying".
    ...(retrying ? { detail: "retrying" } : {}),
  };
}

export async function automationEventsOf(
  ctx: QueryCtx,
  requestId: Doc<"requests">["_id"],
) {
  const events = await ctx.db
    .query("automationEvents")
    .withIndex("by_request", (q) => q.eq("requestId", requestId))
    .collect();
  return events.sort((a, b) => a.updatedAt - b.updatedAt);
}
