import { v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import type { QueryCtx } from "./_generated/server";
import { daysInclusive, isCalendarDate, todayInAppTimeZone } from "./lib/dates";
import { fail } from "./lib/errors";
import { memberMutation, memberQuery, type Me } from "./lib/functions";
import {
  activityOf,
  automationEventsOf,
  queueNotification,
} from "./lib/notifications";
import { hasEnded } from "./lib/overdue";
import { MAX_REQUEST_DAYS } from "./lib/requestFields";
import { requestRow } from "./lib/requestRows";
import {
  assertNoLoanOverlap,
  assertTransition,
  pendingRequestsOf,
  transitionRequest,
} from "./lib/requestLifecycle";

type Ctx = QueryCtx & { me: Me };

const NOT_YOURS = "That Request doesn't exist, or it isn't yours.";

async function loadRequestAsParty(ctx: Ctx, requestId: Id<"requests">) {
  const request = await ctx.db.get("requests", requestId);
  if (
    !request ||
    (request.borrowerId !== ctx.me._id && request.lenderId !== ctx.me._id)
  ) {
    fail("NOT_FOUND", NOT_YOURS);
  }
  return request;
}

async function loadRequestAsLender(ctx: Ctx, requestId: Id<"requests">) {
  const request = await loadRequestAsParty(ctx, requestId);
  if (request.lenderId !== ctx.me._id) {
    fail("FORBIDDEN", "Only the Lender can do that.");
  }
  return request;
}

async function loadRequestAsBorrower(ctx: Ctx, requestId: Id<"requests">) {
  const request = await loadRequestAsParty(ctx, requestId);
  if (request.borrowerId !== ctx.me._id) {
    fail("FORBIDDEN", "Only the Borrower can do that.");
  }
  return request;
}

const toRow = (ctx: Ctx, request: Doc<"requests">, today: string) =>
  requestRow(ctx, request, ctx.me._id, today);

const vRequestId = { requestId: v.id("requests") };

export const create = memberMutation({
  args: { toolId: v.id("tools"), startDate: v.string(), endDate: v.string() },
  handler: async (ctx, { toolId, startDate, endDate }) => {
    const tool = await ctx.db.get("tools", toolId);
    if (!tool || tool.removedAt !== undefined) {
      fail("NOT_FOUND", "That Tool isn't on the board any more.");
    }
    if (tool.ownerId === ctx.me._id) {
      fail("INVALID", "You can't request your own Tool.");
    }
    if (!isCalendarDate(startDate) || !isCalendarDate(endDate)) {
      fail("INVALID", "Pick a From and a To date.");
    }
    if (startDate < todayInAppTimeZone()) {
      fail("INVALID", "The From date can't be in the past.");
    }
    if (endDate < startDate) {
      fail("INVALID", "The To date can't be before the From date.");
    }
    if (daysInclusive(startDate, endDate) > MAX_REQUEST_DAYS) {
      fail("INVALID", `Keep it to ${MAX_REQUEST_DAYS} days or fewer.`);
    }
    const pending = await pendingRequestsOf(ctx, toolId);
    if (pending.some((r) => r.borrowerId === ctx.me._id)) {
      fail("CONFLICT", "You already have a pending Request for this Tool.");
    }
    await assertNoLoanOverlap(ctx, toolId, { startDate, endDate });

    const request = {
      toolId,
      borrowerId: ctx.me._id,
      lenderId: tool.ownerId,
      startDate,
      endDate,
      status: "pending" as const,
    };
    const requestId = await ctx.db.insert("requests", request);
    await queueNotification(
      ctx,
      { _id: requestId, ...request },
      "request.created",
    );
    return requestId;
  },
});

export const approve = memberMutation({
  args: vRequestId,
  handler: async (ctx, { requestId }) => {
    const request = await loadRequestAsLender(ctx, requestId);
    assertTransition(request.status, "approved");
    if (hasEnded(request, todayInAppTimeZone())) {
      fail("CONFLICT", "These dates have passed. Decline it instead.");
    }
    await assertNoLoanOverlap(ctx, request.toolId, request);
    await transitionRequest(ctx, request, "approved", { actorId: ctx.me._id });
  },
});

export const decline = memberMutation({
  args: vRequestId,
  handler: async (ctx, { requestId }) => {
    const request = await loadRequestAsLender(ctx, requestId);
    await transitionRequest(ctx, request, "declined", { actorId: ctx.me._id });
  },
});

export const markReturned = memberMutation({
  args: vRequestId,
  handler: async (ctx, { requestId }) => {
    const request = await loadRequestAsLender(ctx, requestId);
    await transitionRequest(ctx, request, "returned", { actorId: ctx.me._id });
  },
});

export const cancel = memberMutation({
  args: vRequestId,
  handler: async (ctx, { requestId }) => {
    const request = await loadRequestAsBorrower(ctx, requestId);
    await transitionRequest(ctx, request, "cancelled", {
      actorId: ctx.me._id,
    });
  },
});

export const listMine = memberQuery({
  args: {},
  handler: async (ctx) => {
    const today = todayInAppTimeZone();
    const requests = await ctx.db
      .query("requests")
      .withIndex("by_borrower", (q) => q.eq("borrowerId", ctx.me._id))
      .order("desc")
      .collect();
    return await Promise.all(requests.map((r) => toRow(ctx, r, today)));
  },
});

export const listIncoming = memberQuery({
  args: {},
  handler: async (ctx) => {
    const today = todayInAppTimeZone();
    const requests = await ctx.db
      .query("requests")
      .withIndex("by_lender_status", (q) => q.eq("lenderId", ctx.me._id))
      .collect();
    requests.sort((a, b) => b._creationTime - a._creationTime);
    return await Promise.all(requests.map((r) => toRow(ctx, r, today)));
  },
});

export const countPendingIncoming = memberQuery({
  args: {},
  handler: async (ctx) => {
    const pending = await ctx.db
      .query("requests")
      .withIndex("by_lender_status", (q) =>
        q.eq("lenderId", ctx.me._id).eq("status", "pending"),
      )
      .collect();
    return pending.length;
  },
});

const HISTORY_LABELS: Record<string, string> = {
  "request.approved": "Approved",
  "request.declined": "Declined",
  "request.auto_declined": "Declined automatically: the Tool was removed",
  "request.cancelled": "Cancelled",
  "request.returned": "Marked returned",
};

export const get = memberQuery({
  args: vRequestId,
  handler: async (ctx, { requestId }) => {
    const request = await ctx.db.get("requests", requestId);
    const isParty =
      request !== null &&
      (request.borrowerId === ctx.me._id || request.lenderId === ctx.me._id);
    if (!request || (!isParty && ctx.me.role !== "admin")) {
      fail("NOT_FOUND", NOT_YOURS);
    }

    const audit = await ctx.db
      .query("auditLog")
      .withIndex("by_target", (q) => q.eq("target", request._id))
      .collect();
    const events = await automationEventsOf(ctx, request._id);
    const history = [
      { label: "Requested", at: request._creationTime, failed: false },
      ...[
        ...audit.map((row) => ({
          entry: {
            label: HISTORY_LABELS[row.action] ?? row.action,
            at: row.at,
            failed: false,
          },
          order: row._creationTime,
        })),
        ...events.map((event) => ({
          entry: activityOf(event),
          order: event._creationTime,
        })),
      ]
        .sort((a, b) => a.entry.at - b.entry.at || a.order - b.order)
        .map(({ entry }) => entry),
    ];

    return {
      ...(await toRow(ctx, request, todayInAppTimeZone())),
      viewerRole:
        request.lenderId === ctx.me._id
          ? ("lender" as const)
          : request.borrowerId === ctx.me._id
            ? ("borrower" as const)
            : ("admin" as const),
      history,
    };
  },
});
