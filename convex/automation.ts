import { v } from "convex/values";
import { eventKeys, lastReminderRunAt } from "./lib/automationEvents";
import { STUCK_AFTER_MS } from "./lib/automationFields";
import { isStuck, WAITING_STATUSES } from "./lib/automationPolicy";
import { hourInAppTimeZone, todayInAppTimeZone } from "./lib/dates";
import { internalMutation } from "./lib/functions";
import { overdueLoans } from "./lib/overdue";
import { recordWorkflowError, WORKFLOW_EVENTS } from "./lib/workflowErrors";

// n8n's daily run is at 09:00 in APP_TIMEZONE; give it an hour.
const MISSED_RUN_HOUR = 10;

export const recordExecutionFailure = internalMutation({
  args: {
    executionId: v.string(),
    error: v.string(),
    workflowName: v.optional(v.string()),
    failedNode: v.optional(v.string()),
    executionUrl: v.optional(v.string()),
  },
  handler: async (ctx, { executionId, ...rest }) =>
    await recordWorkflowError(ctx, {
      ...rest,
      idempotencyKey: eventKeys.executionFailure(executionId),
      event: WORKFLOW_EVENTS.executionFailed,
    }),
});

export const recordTriggerFailure = internalMutation({
  args: { error: v.string() },
  handler: async (ctx, { error }) => {
    const now = Date.now();
    await recordWorkflowError(ctx, {
      idempotencyKey: eventKeys.triggerFailure(now),
      event: WORKFLOW_EVENTS.triggerFailed,
      workflowName: "LendLoop: overdue reminders",
      error: `Could not start the reminder run: ${error}`,
    });
  },
});

export const markStuckEvents = internalMutation({
  args: {},
  handler: async (ctx) => {
    const now = Date.now();
    const cutoff = now - STUCK_AFTER_MS;
    const waiting = (
      await Promise.all(
        WAITING_STATUSES.map((status) =>
          ctx.db
            .query("automationEvents")
            .withIndex("by_status_updatedAt", (q) =>
              q.eq("status", status).lt("updatedAt", cutoff),
            )
            .collect(),
        ),
      )
    ).flat();
    for (const event of waiting.filter((e) => isStuck(e, now))) {
      await ctx.db.patch("automationEvents", event._id, {
        status: "failed",
        lastError: "No confirmation from n8n",
        updatedAt: now,
      });
    }
  },
});

// Runs hourly and judges the hour and the day in APP_TIMEZONE, because Convex
// crons only speak UTC. The per-day key keeps it to one row a day.
export const checkMissedReminderRun = internalMutation({
  args: {},
  handler: async (ctx) => {
    const now = Date.now();
    if (hourInAppTimeZone(now) < MISSED_RUN_HOUR) return;
    const today = todayInAppTimeZone(now);
    const lastRun = await lastReminderRunAt(ctx);
    if (lastRun !== null && todayInAppTimeZone(lastRun) === today) return;
    const overdue = await overdueLoans(ctx, today).first();
    if (!overdue) return;
    await recordWorkflowError(ctx, {
      idempotencyKey: eventKeys.missedRun(today),
      event: WORKFLOW_EVENTS.missedRun,
      workflowName: "LendLoop: overdue reminders",
      error: "Reminder run missed",
    });
  },
});
