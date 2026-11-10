import { v } from "convex/values";
import { internal } from "./_generated/api";
import { sanitiseError } from "./lib/automationFields";
import { daysInclusive, isCalendarDate, todayInAppTimeZone } from "./lib/dates";
import { convexToN8nSecret, n8nRemindersWebhookUrl } from "./lib/env";
import { internalAction, internalMutation } from "./lib/functions";
import { postSigned, webhookUrl } from "./lib/n8nClient";
import {
  parseReminderKey,
  REMINDER_EVENT,
  reminderKeyOf,
} from "./lib/reminders";

export const overdueLoans = internalMutation({
  args: {},
  handler: async (ctx) => {
    const now = Date.now();
    const asOf = todayInAppTimeZone(now);
    const state = await ctx.db
      .query("automationState")
      .withIndex("by_key", (q) => q.eq("key", "reminders"))
      .unique();
    if (state) {
      await ctx.db.patch("automationState", state._id, {
        lastReminderRunAt: now,
      });
    } else {
      await ctx.db.insert("automationState", {
        key: "reminders",
        lastReminderRunAt: now,
      });
    }

    const overdue = await ctx.db
      .query("requests")
      .withIndex("by_status_endDate", (q) =>
        q.eq("status", "approved").lt("endDate", asOf),
      )
      .collect();
    const loans = [];
    for (const loan of overdue) {
      const reminderKey = reminderKeyOf(loan._id, asOf);
      const reminder = await ctx.db
        .query("automationEvents")
        .withIndex("by_idempotency_key", (q) =>
          q.eq("idempotencyKey", reminderKey),
        )
        .first();
      if (reminder?.status === "sent") continue;
      const [borrower, tool] = await Promise.all([
        ctx.db.get("users", loan.borrowerId),
        ctx.db.get("tools", loan.toolId),
      ]);
      if (!borrower) continue;
      loans.push({
        loanId: loan._id,
        reminderKey,
        borrowerEmail: borrower.email,
        borrowerFirstName: borrower.firstName,
        toolName: tool?.name ?? "borrowed tool",
        endDate: loan.endDate,
        daysOverdue: daysInclusive(loan.endDate, asOf) - 1,
      });
    }
    return { asOf, loans };
  },
});

export const recordWriteBack = internalMutation({
  args: {
    reminderKey: v.string(),
    status: v.union(v.literal("sent"), v.literal("failed")),
    error: v.optional(v.string()),
  },
  handler: async (ctx, { reminderKey, status, error }) => {
    const parsed = parseReminderKey(reminderKey);
    const loanId = parsed && ctx.db.normalizeId("requests", parsed.loanId);
    const loan = loanId ? await ctx.db.get("requests", loanId) : null;
    if (!parsed || !isCalendarDate(parsed.asOf) || !loan) {
      return "invalid" as const;
    }

    const lastError =
      status === "failed"
        ? sanitiseError(error ?? "n8n could not send the email")
        : undefined;
    const updatedAt = Date.now();
    const existing = await ctx.db
      .query("automationEvents")
      .withIndex("by_idempotency_key", (q) =>
        q.eq("idempotencyKey", reminderKey),
      )
      .first();
    if (!existing) {
      await ctx.db.insert("automationEvents", {
        requestId: loan._id,
        kind: "reminder",
        event: REMINDER_EVENT,
        idempotencyKey: reminderKey,
        recipientId: loan.borrowerId,
        status,
        attempts: 1,
        lastError,
        updatedAt,
      });
      return "inserted" as const;
    }
    if (existing.status === "sent") return "duplicate" as const;
    await ctx.db.patch("automationEvents", existing._id, {
      status,
      attempts: existing.attempts + 1,
      lastError,
      updatedAt,
    });
    return "updated" as const;
  },
});

async function startRun(): Promise<string | null> {
  const secret = convexToN8nSecret();
  if (!n8nRemindersWebhookUrl() || !secret) {
    return "Reminders are not configured: set N8N_REMINDERS_WEBHOOK_URL and CONVEX_TO_N8N_SECRET";
  }
  const url = webhookUrl(n8nRemindersWebhookUrl());
  if (!url) {
    return "Reminders are not configured: N8N_REMINDERS_WEBHOOK_URL is not an http(s) URL";
  }
  const body = JSON.stringify({ requestedAt: new Date().toISOString() });
  const res = await postSigned(url, secret, body);
  if ("error" in res) return res.error;
  return res.status >= 200 && res.status < 300
    ? null
    : `n8n answered ${res.status}`;
}

export const triggerRun = internalAction({
  args: {},
  handler: async (ctx): Promise<void> => {
    const error = await startRun();
    if (error) {
      await ctx.runMutation(internal.automation.recordTriggerFailure, {
        error,
      });
    }
  },
});
