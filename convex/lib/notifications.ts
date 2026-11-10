import { internal } from "../_generated/api";
import type { Doc } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";
import type { NotificationEvent } from "./automationFields";

const TO_LENDER: readonly NotificationEvent[] = [
  "request.created",
  "request.cancelled",
];

export function recipientOf(
  request: Pick<Doc<"requests">, "lenderId" | "borrowerId">,
  event: NotificationEvent,
) {
  return TO_LENDER.includes(event) ? request.lenderId : request.borrowerId;
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
  const idempotencyKey = `notify:${request._id}:${event}`;
  const existing = await ctx.db
    .query("automationEvents")
    .withIndex("by_idempotency_key", (q) =>
      q.eq("idempotencyKey", idempotencyKey),
    )
    .first();
  if (existing) return existing._id;

  const eventId = await ctx.db.insert("automationEvents", {
    requestId: request._id,
    kind: "notification",
    event,
    idempotencyKey,
    recipientId: recipientOf(request, event),
    status: "pending",
    attempts: 0,
    updatedAt: Date.now(),
  });
  await ctx.scheduler.runAfter(0, internal.notifications.deliver, { eventId });
  return eventId;
}

const SUBJECT: Record<string, string> = {
  "request.created": "Request email to lender",
  "request.cancelled": "Cancellation email to lender",
  "request.approved": "Approval email to borrower",
  "request.declined": "Decline email to borrower",
  "request.auto_declined": "Decline email to borrower",
  "request.returned": "Return email to borrower",
};

export function activityOf(event: Doc<"automationEvents">) {
  const subject = SUBJECT[event.event] ?? "Email";
  const retrying = event.status === "pending" && event.attempts > 0;
  const phrase = retrying
    ? "failed, retrying"
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
