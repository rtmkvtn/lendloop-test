import type { Id } from "../_generated/dataModel";
import type { QueryCtx } from "../_generated/server";

export const REMINDER_EVENT = "reminder.overdue";

const KEY_RE = /^reminder:([^:]+):(\d{4}-\d{2}-\d{2})$/;

export function reminderKeyOf(loanId: Id<"requests">, asOf: string) {
  return `reminder:${loanId}:${asOf}`;
}

export function parseReminderKey(key: string) {
  const match = KEY_RE.exec(key);
  return match ? { loanId: match[1]!, asOf: match[2]! } : null;
}

export async function lastReminderRunAt(ctx: QueryCtx) {
  const state = await ctx.db
    .query("automationState")
    .withIndex("by_key", (q) => q.eq("key", "reminders"))
    .unique();
  return state?.lastReminderRunAt ?? null;
}
