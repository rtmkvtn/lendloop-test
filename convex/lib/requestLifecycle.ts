import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";
import { appendAudit } from "./audit";
import type { NotificationEvent } from "./automationFields";
import { queueNotification } from "./notifications";
import { rangesOverlap, todayInAppTimeZone } from "./dates";
import { fail } from "./errors";
import { hasEnded } from "./overdue";
import {
  REQUEST_ACTIONS,
  type RequestAction,
  type RequestStatus,
} from "./requestFields";

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

function assertTransition(from: RequestStatus, to: RequestStatus) {
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

type Party = "lender" | "borrower";

type ActionRule = {
  by: Party;
  to: Exclude<RequestStatus, "pending">;
  // A reason the action is closed although the status allows it.
  blockedBecause?: (request: Doc<"requests">, today: string) => string | null;
  // Checked only when the action runs, never when listing actions.
  beforeTransition?: (
    ctx: MutationCtx,
    request: Doc<"requests">,
  ) => Promise<void>;
};

const ACTIONS: Record<RequestAction, ActionRule> = {
  approve: {
    by: "lender",
    to: "approved",
    blockedBecause: (request, today) =>
      hasEnded(request, today)
        ? "These dates have passed. Decline it instead."
        : null,
    beforeTransition: (ctx, request) =>
      assertNoLoanOverlap(ctx, request.toolId, request),
  },
  decline: { by: "lender", to: "declined" },
  markReturned: { by: "lender", to: "returned" },
  cancel: { by: "borrower", to: "cancelled" },
};

const ONLY: Record<Party, string> = {
  lender: "Only the Lender can do that.",
  borrower: "Only the Borrower can do that.",
};

export const NOT_YOURS = "That Request doesn't exist, or it isn't yours.";

function partyOf(request: Doc<"requests">, viewerId: Id<"users">) {
  if (viewerId === request.lenderId) return "lender";
  if (viewerId === request.borrowerId) return "borrower";
  return null;
}

export function allowedActions(
  request: Doc<"requests">,
  viewerId: Id<"users">,
  today: string,
): RequestAction[] {
  const party = partyOf(request, viewerId);
  return REQUEST_ACTIONS.filter((action) => {
    const rule = ACTIONS[action];
    return (
      rule.by === party &&
      ALLOWED[request.status].includes(rule.to) &&
      !rule.blockedBecause?.(request, today)
    );
  });
}

// The one way a Member acts on a Request; it accepts exactly the actions
// allowedActions offers, plus the Loan overlap re-check for approvals.
export async function performAction(
  ctx: MutationCtx,
  requestId: Id<"requests">,
  action: RequestAction,
  actorId: Id<"users">,
) {
  const request = await ctx.db.get("requests", requestId);
  const party = request && partyOf(request, actorId);
  if (!request || !party) fail("NOT_FOUND", NOT_YOURS);
  const rule = ACTIONS[action];
  if (party !== rule.by) fail("FORBIDDEN", ONLY[rule.by]);
  assertTransition(request.status, rule.to);
  const blocked = rule.blockedBecause?.(request, todayInAppTimeZone());
  if (blocked) fail("CONFLICT", blocked);
  await rule.beforeTransition?.(ctx, request);
  await transitionRequest(ctx, request, rule.to, { actorId });
}
