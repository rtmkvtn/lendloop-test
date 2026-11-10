import { v } from "convex/values";
import { sanitiseError } from "./lib/automationFields";
import { daysInclusive, isCalendarDate, todayInAppTimeZone } from "./lib/dates";
import { convexToN8nSecret, n8nRemindersWebhookUrl } from "./lib/env";
import { internalAction, internalMutation } from "./lib/functions";
import {
  parseReminderKey,
  REMINDER_EVENT,
  reminderKeyOf,
} from "./lib/reminders";
import { signedHeaders } from "./lib/signature";

const TIMEOUT_MS = 10_000;

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

export const triggerRun = internalAction({
  args: {},
  handler: async (): Promise<void> => {
    const url = n8nRemindersWebhookUrl();
    const secret = convexToN8nSecret();
    if (!url || !secret) {
      throw new Error(
        "Reminders are not configured: set N8N_REMINDERS_WEBHOOK_URL and CONVEX_TO_N8N_SECRET",
      );
    }
    const body = JSON.stringify({ requestedAt: new Date().toISOString() });
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(await signedHeaders(secret, {
          method: "POST",
          path: new URL(url).pathname,
          body,
        })),
      },
      body,
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!res.ok) throw new Error(`n8n answered ${res.status}`);
  },
});
