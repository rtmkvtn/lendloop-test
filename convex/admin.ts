import { v } from "convex/values";
import { internal } from "./_generated/api";
import { appendAudit } from "./lib/audit";
import { availabilityOf } from "./lib/availability";
import { todayInAppTimeZone } from "./lib/dates";
import { fail } from "./lib/errors";
import { adminMutation, adminQuery } from "./lib/functions";
import { displayName } from "./lib/members";
import { queueToolRemovedNotification } from "./lib/notifications";
import { pendingRequestsOf, transitionRequest } from "./lib/requestLifecycle";
import { requestRow } from "./lib/requestRows";
import { REASON_MAX } from "./lib/toolFields";

// A live Loan doesn't block removal: it stays approved and visible to both
// parties until the Lender marks it returned.
export const removeTool = adminMutation({
  args: { toolId: v.id("tools"), reason: v.string() },
  handler: async (ctx, args) => {
    const reason = args.reason.trim();
    if (!reason) fail("INVALID", "Give a reason for removing this listing.");
    if (reason.length > REASON_MAX) {
      fail("INVALID", `Keep the reason to ${REASON_MAX} characters.`);
    }
    const tool = await ctx.db.get("tools", args.toolId);
    if (!tool || tool.removedAt !== undefined) {
      fail("NOT_FOUND", "That Tool isn't on the board any more.");
    }

    for (const request of await pendingRequestsOf(ctx, tool._id)) {
      await transitionRequest(ctx, request, "declined", {
        actorId: ctx.me._id,
        auto: true,
      });
    }
    await ctx.db.patch("tools", tool._id, {
      removedAt: Date.now(),
      removedBy: ctx.me._id,
      removalReason: reason,
    });
    await appendAudit(ctx, {
      actorId: ctx.me._id,
      action: "tool.removed",
      target: tool._id,
    });
    await queueToolRemovedNotification(ctx, tool);
  },
});

const LOAN_STATUSES = ["approved", "returned"] as const;

export const listLoans = adminQuery({
  args: {
    status: v.optional(v.union(...LOAN_STATUSES.map((s) => v.literal(s)))),
  },
  handler: async (ctx, { status }) => {
    const loans = (
      await Promise.all(
        (status ? [status] : LOAN_STATUSES).map((s) =>
          ctx.db
            .query("requests")
            .withIndex("by_status_endDate", (q) => q.eq("status", s))
            .collect(),
        ),
      )
    ).flat();
    loans.sort((a, b) => b._creationTime - a._creationTime);
    const today = todayInAppTimeZone();
    return await Promise.all(
      loans.map((loan) => requestRow(ctx, loan, ctx.me._id, today)),
    );
  },
});

export const setTrustedLender = adminMutation({
  args: { userId: v.id("users"), trusted: v.boolean() },
  handler: async (ctx, { userId, trusted }) => {
    const user = await ctx.db.get("users", userId);
    if (!user) fail("NOT_FOUND", "That Member doesn't exist.");
    await ctx.db.patch("users", userId, { trustedLender: trusted });
    await appendAudit(ctx, {
      actorId: ctx.me._id,
      action: trusted
        ? "user.trusted_lender_granted"
        : "user.trusted_lender_revoked",
      target: userId,
    });
  },
});

export const listLenders = adminQuery({
  args: {},
  handler: async (ctx) => {
    const users = await ctx.db.query("users").collect();
    const rows = await Promise.all(
      users.map(async (user) => {
        const tools = await ctx.db
          .query("tools")
          .withIndex("by_owner", (q) => q.eq("ownerId", user._id))
          .collect();
        return {
          _id: user._id,
          name: displayName(user),
          trusted: user.trustedLender,
          listings: tools.filter((t) => t.removedAt === undefined).length,
        };
      }),
    );
    return rows.sort((a, b) => a.name.localeCompare(b.name));
  },
});

export const listListings = adminQuery({
  args: {},
  handler: async (ctx) => {
    const tools = await ctx.db.query("tools").order("desc").collect();
    return await Promise.all(
      tools.map(async (tool) => {
        const owner = await ctx.db.get("users", tool.ownerId);
        return {
          _id: tool._id,
          name: tool.name,
          category: tool.category,
          condition: tool.condition,
          lender: {
            name: displayName(owner),
            trusted: owner?.trustedLender ?? false,
          },
          availability: await availabilityOf(ctx, tool),
          removed:
            tool.removedAt === undefined
              ? null
              : { at: tool.removedAt, reason: tool.removalReason ?? null },
        };
      }),
    );
  },
});

export const runRemindersNow = adminMutation({
  args: {},
  handler: async (ctx) => {
    await appendAudit(ctx, {
      actorId: ctx.me._id,
      action: "reminders.run_now",
      target: ctx.me._id,
    });
    await ctx.scheduler.runAfter(0, internal.reminders.triggerRun, {});
  },
});
