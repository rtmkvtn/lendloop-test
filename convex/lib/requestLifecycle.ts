import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";
import { appendAudit } from "./audit";
import type { NotificationEvent } from "./automationFields";
import { queueNotification } from "./notifications";
import { rangesOverlap } from "./dates";
import { fail } from "./errors";
import type { RequestAction, RequestStatus } from "./requestFields";

const ALLOWED: Record<RequestStatus, readonly RequestStatus[]> = {
  pending: ["approved", "declined", "cancelled"],
  approved: ["returned"],
  declined: [],
  cancelled: [],
  returned: [],
};

const NOT_ALLOWED: Record<RequestStatus, string> = {
  pending: "This Request is still pending.",
  approved: "This Request is already approved.",
  declined: "This Request was declined.",
  cancelled: "This Request was cancelled.",
  returned: "This Loan was already returned.",
};

export function assertTransition(from: RequestStatus, to: RequestStatus) {
  if (!ALLOWED[from].includes(to)) fail("CONFLICT", NOT_ALLOWED[from]);
}

const TIMESTAMP_FIELD = {
  approved: "decidedAt",
  declined: "decidedAt",
  cancelled: "cancelledAt",
  returned: "returnedAt",
} as const;

// The one place a Request changes status: the audit row and the Notification
// commit in the same transaction as the patch.
export async function transitionRequest(
  ctx: MutationCtx,
  request: Doc<"requests">,
  to: Exclude<RequestStatus, "pending">,
  by: { actorId: Id<"users">; auto?: boolean },
) {
  assertTransition(request.status, to);
  await ctx.db.patch("requests", request._id, {
    status: to,
    [TIMESTAMP_FIELD[to]]: Date.now(),
  });
  const event: NotificationEvent = by.auto
    ? "request.auto_declined"
    : `request.${to}`;
  await appendAudit(ctx, {
    actorId: by.actorId,
    action: event,
    target: request._id,
  });
  await queueNotification(ctx, request, event);
}

export async function loansOf(ctx: QueryCtx, toolId: Id<"tools">) {
  return await ctx.db
    .query("requests")
    .withIndex("by_tool_status", (q) =>
      q.eq("toolId", toolId).eq("status", "approved"),
    )
    .collect();
}

export async function pendingRequestsOf(ctx: QueryCtx, toolId: Id<"tools">) {
  return await ctx.db
    .query("requests")
    .withIndex("by_tool_status", (q) =>
      q.eq("toolId", toolId).eq("status", "pending"),
    )
    .collect();
}

export async function assertNoLoanOverlap(
  ctx: QueryCtx,
  toolId: Id<"tools">,
  dates: { startDate: string; endDate: string },
) {
  const loans = await loansOf(ctx, toolId);
  if (loans.some((loan) => rangesOverlap(loan, dates))) {
    fail("CONFLICT", "Those dates overlap an existing loan");
  }
}

export function allowedActions(
  request: Doc<"requests">,
  viewerId: Id<"users">,
  today: string,
): RequestAction[] {
  if (viewerId === request.lenderId) {
    if (request.status === "pending") {
      return request.endDate >= today ? ["approve", "decline"] : ["decline"];
    }
    if (request.status === "approved") return ["markReturned"];
  }
  if (viewerId === request.borrowerId && request.status === "pending") {
    return ["cancel"];
  }
  return [];
}
