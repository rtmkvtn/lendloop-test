import { v } from "convex/values";
import { internal } from "./_generated/api";
import { appendAudit } from "./lib/audit";
import { type AutomationStatus, STUCK_AFTER_MS } from "./lib/automationFields";
import {
  isStuck,
  KIND_POLICY,
  policyOf,
  RETRYABLE_KINDS,
  type RetryableKind,
} from "./lib/automationPolicy";
import { availabilityOf } from "./lib/availability";
import { todayInAppTimeZone } from "./lib/dates";
import { fail } from "./lib/errors";
import { adminMutation, adminQuery } from "./lib/functions";
import { displayName, lenderOf } from "./lib/members";
import { queueToolRemovedNotification, subjectOf } from "./lib/notifications";
import { overdueLoans } from "./lib/overdue";
import { lastReminderRunAt } from "./lib/automationEvents";
import { pendingRequestsOf, transitionRequest } from "./lib/requestLifecycle";
import { requestRow } from "./lib/requestRows";
import { REASON_MAX } from "./lib/toolFields";

// A live Loan doesn't block removal: it stays approved and visible to both
// parties until the Lender marks it returned.
export const removeTool = adminMutation({
  args: { toolId: v.id("tools"), reason: v.string() },
  handler: async (ctx, args) => {
    const reason = args.reason.trim();
    if (!reason) fail("INVALID", "Give a reason for removing this Tool.");
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
const LOAN_FILTERS = [...LOAN_STATUSES, "overdue"] as const;

export const listLoans = adminQuery({
  args: {
    status: v.optional(v.union(...LOAN_FILTERS.map((s) => v.literal(s)))),
  },
  handler: async (ctx, { status }) => {
    const today = todayInAppTimeZone();
    const loans =
      status === "overdue"
        ? await overdueLoans(ctx, today).collect()
        : (
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
    const [users, tools] = await Promise.all([
      ctx.db.query("users").collect(),
      ctx.db.query("tools").collect(),
    ]);
    const toolCounts = new Map<string, number>();
    for (const tool of tools) {
      if (tool.removedAt !== undefined) continue;
      toolCounts.set(tool.ownerId, (toolCounts.get(tool.ownerId) ?? 0) + 1);
    }
    return users
      .map((user) => ({
        _id: user._id,
        name: displayName(user),
        trusted: user.trustedLender,
        tools: toolCounts.get(user._id) ?? 0,
      }))
      .sort((a, b) => a.name.localeCompare(b.name));
  },
});

export const listTools = adminQuery({
  args: {},
  handler: async (ctx) => {
    const tools = await ctx.db.query("tools").order("desc").collect();
    return await Promise.all(
      tools.map(async (tool) => {
        const lender = await ctx.db.get("users", tool.ownerId);
        return {
          _id: tool._id,
          name: tool.name,
          category: tool.category,
          condition: tool.condition,
          lender: lenderOf(lender),
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

// Reuses the event's row and idempotency key. Bumping retryGeneration changes
// the deliveryId, which is what n8n dedupes on, so the retry isn't swallowed.
export const retryEvent = adminMutation({
  args: { eventId: v.id("automationEvents") },
  handler: async (ctx, { eventId }) => {
    const event = await ctx.db.get("automationEvents", eventId);
    if (!event) fail("NOT_FOUND", "That event doesn't exist.");
    const policy = policyOf(event.kind);
    if (!policy) {
      fail("INVALID", "Workflow errors can't be retried; fix the cause.");
    }
    if (event.status !== "failed" && !isStuck(event)) {
      fail("CONFLICT", "Only failed or stuck events can be retried.");
    }

    await policy.retry(ctx, event, {
      status: "pending",
      retryGeneration: (event.retryGeneration ?? 0) + 1,
      lastError: undefined,
      updatedAt: Date.now(),
    });
    await appendAudit(ctx, {
      actorId: ctx.me._id,
      action: "automation.retried",
      target: eventId,
    });
  },
});

const HEALTH_LIMIT = 50;
const WORKFLOW_ERROR_LIMIT = 20;

export const automationHealth = adminQuery({
  args: {},
  handler: async (ctx) => {
    const now = Date.now();
    const cutoff = now - STUCK_AFTER_MS;
    // Per kind, so a burst of workflow errors can't crowd failed emails out.
    const byKindAndStatus = (kind: RetryableKind, status: AutomationStatus) =>
      ctx.db
        .query("automationEvents")
        .withIndex("by_kind_status_updatedAt", (q) =>
          status === "failed"
            ? q.eq("kind", kind).eq("status", status)
            : q.eq("kind", kind).eq("status", status).lt("updatedAt", cutoff),
        )
        .order("desc")
        .take(HEALTH_LIMIT);
    const candidates = (
      await Promise.all(
        RETRYABLE_KINDS.flatMap((kind) =>
          ["failed" as const, ...KIND_POLICY[kind].waitsAs].map((status) =>
            byKindAndStatus(kind, status),
          ),
        ),
      )
    ).flat();
    const troubled = candidates
      .filter((e) => e.status === "failed" || isStuck(e, now))
      .sort((a, b) => b.updatedAt - a.updatedAt)
      .slice(0, HEALTH_LIMIT);

    const events = await Promise.all(
      troubled.map(async (event) => {
        const request = event.requestId
          ? await ctx.db.get("requests", event.requestId)
          : null;
        const toolId = event.toolId ?? request?.toolId;
        const tool = toolId ? await ctx.db.get("tools", toolId) : null;
        return {
          _id: event._id,
          kind: event.kind,
          label: subjectOf(event),
          toolName: tool?.name ?? null,
          requestId: event.requestId ?? null,
          status: event.status,
          stuck: event.status !== "failed",
          lastError: event.lastError ?? null,
          attempts: event.attempts,
          updatedAt: event.updatedAt,
        };
      }),
    );

    const workflowErrors = (
      await ctx.db
        .query("automationEvents")
        .withIndex("by_kind_updatedAt", (q) => q.eq("kind", "workflow_error"))
        .order("desc")
        .take(WORKFLOW_ERROR_LIMIT)
    ).map((e) => ({
      _id: e._id,
      event: e.event,
      workflowName: e.workflowName ?? null,
      failedNode: e.failedNode ?? null,
      executionUrl: e.executionUrl ?? null,
      message: e.lastError ?? null,
      at: e.updatedAt,
    }));

    return {
      events,
      workflowErrors,
      lastReminderRunAt: await lastReminderRunAt(ctx),
    };
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
