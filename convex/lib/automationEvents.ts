// Writers look an event up by key in the same transaction as their write,
// because every receiver must be idempotent (ADR-0003).
import type { Id } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";

const REMINDER_KEY_RE = /^reminder:([^:]+):(\d{4}-\d{2}-\d{2})$/;

export const eventKeys = {
  notification: (target: Id<"requests"> | Id<"tools">, event: string) =>
    `notify:${target}:${event}`,
  reminder: (loanId: Id<"requests">, asOf: string) =>
    `reminder:${loanId}:${asOf}`,
  executionFailure: (executionId: string) =>
    `workflow_error:n8n:${executionId}`,
  triggerFailure: (now: number) => `workflow_error:trigger:${now}`,
  missedRun: (day: string) => `workflow_error:missed_run:${day}`,
};

export function parseReminderKey(key: string) {
  const match = REMINDER_KEY_RE.exec(key);
  return match ? { loanId: match[1]!, asOf: match[2]! } : null;
}

export async function eventByKey(ctx: QueryCtx, idempotencyKey: string) {
  return await ctx.db
    .query("automationEvents")
    .withIndex("by_idempotency_key", (q) =>
      q.eq("idempotencyKey", idempotencyKey),
    )
    .first();
}

async function reminderRunState(ctx: QueryCtx) {
  return await ctx.db
    .query("automationState")
    .withIndex("by_key", (q) => q.eq("key", "reminders"))
    .unique();
}

export async function lastReminderRunAt(ctx: QueryCtx) {
  return (await reminderRunState(ctx))?.lastReminderRunAt ?? null;
}

export async function recordReminderRun(ctx: MutationCtx, at: number) {
  const state = await reminderRunState(ctx);
  if (state) {
    await ctx.db.patch("automationState", state._id, { lastReminderRunAt: at });
  } else {
    await ctx.db.insert("automationState", {
      key: "reminders",
      lastReminderRunAt: at,
    });
  }
}
