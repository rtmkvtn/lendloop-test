import { v } from "convex/values";
import { internal } from "./_generated/api";
import {
  eventByKey,
  eventKeys,
  parseReminderKey,
  recordReminderRun,
} from "./lib/automationEvents";
import {
  REMINDER_EVENT,
  vWriteBackStatus,
  writeBackError,
} from "./lib/automationFields";
import { daysInclusive, isCalendarDate, todayInAppTimeZone } from "./lib/dates";
import { convexToN8nSecret, n8nRemindersWebhookUrl } from "./lib/env";
import { internalAction, internalMutation } from "./lib/functions";
import { parseHttpUrl, postSigned } from "./lib/n8nClient";
import { overdueLoans as overdueLoansQuery } from "./lib/overdue";

export const overdueLoans = internalMutation({
  args: {},
  handler: async (ctx) => {
    const now = Date.now();
    const asOf = todayInAppTimeZone(now);
    await recordReminderRun(ctx, now);

    const overdue = await overdueLoansQuery(ctx, asOf).collect();
    const loans = [];
    for (const loan of overdue) {
      const reminderKey = eventKeys.reminder(loan._id, asOf);
      const reminder = await eventByKey(ctx, reminderKey);
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
    status: vWriteBackStatus,
    error: v.optional(v.string()),
  },
  handler: async (ctx, { reminderKey, status, error }) => {
    const parsed = parseReminderKey(reminderKey);
    const loanId = parsed && ctx.db.normalizeId("requests", parsed.loanId);
    const loan = loanId ? await ctx.db.get("requests", loanId) : null;
    if (!parsed || !isCalendarDate(parsed.asOf) || !loan) {
      return "invalid" as const;
    }

    const lastError = writeBackError(status, error);
    const updatedAt = Date.now();
    const existing = await eventByKey(ctx, reminderKey);
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
  const url = parseHttpUrl(n8nRemindersWebhookUrl());
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
