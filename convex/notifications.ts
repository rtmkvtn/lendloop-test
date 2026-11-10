import { v } from "convex/values";
import { internal } from "./_generated/api";
import { sanitiseError } from "./lib/automationFields";
import { appUrl, convexToN8nSecret, n8nNotifyWebhookUrl } from "./lib/env";
import {
  internalAction,
  internalMutation,
  internalQuery,
} from "./lib/functions";
import { deliveryIdOf } from "./lib/notifications";
import { signedHeaders } from "./lib/signature";

const MAX_ATTEMPTS = 5;
const RETRY_DELAYS_MS = [30_000, 120_000, 600_000, 3_600_000];
const TIMEOUT_MS = 10_000;

export const loadDelivery = internalQuery({
  args: { eventId: v.id("automationEvents") },
  handler: async (ctx, { eventId }) => {
    const event = await ctx.db.get("automationEvents", eventId);
    if (!event || event.kind !== "notification" || event.status !== "pending") {
      return null;
    }
    const request = event.requestId
      ? await ctx.db.get("requests", event.requestId)
      : null;
    const recipient = event.recipientId
      ? await ctx.db.get("users", event.recipientId)
      : null;
    const tool = request ? await ctx.db.get("tools", request.toolId) : null;
    if (!request || !recipient || !tool) return { missing: true as const };

    const page = recipient._id === request.lenderId ? "incoming" : "requests";
    return {
      missing: false as const,
      deliveryId: deliveryIdOf(event),
      event: event.event,
      recipient: { email: recipient.email, firstName: recipient.firstName },
      tool: { name: tool.name },
      dates: { start: request.startDate, end: request.endDate },
      link: `${appUrl()}/${page}?request=${request._id}`,
    };
  },
});

const vOutcome = v.union(
  v.literal("accepted"),
  v.literal("retry"),
  v.literal("failed"),
);

export const deliver = internalAction({
  args: { eventId: v.id("automationEvents") },
  handler: async (ctx, { eventId }): Promise<void> => {
    const delivery = await ctx.runQuery(internal.notifications.loadDelivery, {
      eventId,
    });
    if (!delivery) return;
    const record = async (
      outcome: "accepted" | "retry" | "failed",
      error?: string,
    ): Promise<void> => {
      await ctx.runMutation(internal.notifications.recordDelivery, {
        eventId,
        outcome,
        error,
      });
    };

    if (delivery.missing) {
      return await record("failed", "The Request or its recipient is gone");
    }
    const url = n8nNotifyWebhookUrl();
    const secret = convexToN8nSecret();
    if (!url || !secret) {
      return await record(
        "failed",
        "Notifications are not configured: set N8N_NOTIFY_WEBHOOK_URL and CONVEX_TO_N8N_SECRET",
      );
    }

    const body = JSON.stringify({
      eventId,
      deliveryId: delivery.deliveryId,
      sentAt: new Date().toISOString(),
      event: delivery.event,
      recipient: delivery.recipient,
      tool: delivery.tool,
      dates: delivery.dates,
      link: delivery.link,
    });
    const headers = {
      "Content-Type": "application/json",
      ...(await signedHeaders(secret, {
        method: "POST",
        path: new URL(url).pathname,
        body,
      })),
    };

    let status: number;
    try {
      const res = await fetch(url, {
        method: "POST",
        headers,
        body,
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      status = res.status;
    } catch (e) {
      const timedOut =
        e instanceof Error && ["TimeoutError", "AbortError"].includes(e.name);
      return await record(
        "retry",
        timedOut ? "n8n did not answer within 10 s" : "Could not reach n8n",
      );
    }
    if (status >= 200 && status < 300) return await record("accepted");
    return await record(
      status >= 500 ? "retry" : "failed",
      `n8n answered ${status}`,
    );
  },
});

export const recordDelivery = internalMutation({
  args: {
    eventId: v.id("automationEvents"),
    outcome: vOutcome,
    error: v.optional(v.string()),
  },
  handler: async (ctx, { eventId, outcome, error }) => {
    const event = await ctx.db.get("automationEvents", eventId);
    // n8n can write back before this runs; never move a settled event backwards.
    if (!event || event.status !== "pending") return;
    const attempts = event.attempts + 1;
    const updatedAt = Date.now();
    const lastError = error === undefined ? undefined : sanitiseError(error);

    if (outcome === "accepted") {
      await ctx.db.patch("automationEvents", eventId, {
        status: "accepted",
        attempts,
        lastError: undefined,
        updatedAt,
      });
      return;
    }
    if (outcome === "retry" && attempts < MAX_ATTEMPTS) {
      await ctx.db.patch("automationEvents", eventId, {
        attempts,
        lastError,
        updatedAt,
      });
      await ctx.scheduler.runAfter(
        RETRY_DELAYS_MS[attempts - 1]!,
        internal.notifications.deliver,
        { eventId },
      );
      return;
    }
    await ctx.db.patch("automationEvents", eventId, {
      status: "failed",
      attempts,
      lastError,
      updatedAt,
    });
  },
});

export const recordWriteBack = internalMutation({
  args: {
    eventId: v.string(),
    status: v.union(v.literal("sent"), v.literal("failed")),
    error: v.optional(v.string()),
  },
  handler: async (ctx, { eventId, status, error }) => {
    const id = ctx.db.normalizeId("automationEvents", eventId);
    const event = id ? await ctx.db.get("automationEvents", id) : null;
    if (!event || event.kind !== "notification") return "not_found" as const;
    if (event.status === "sent" || event.status === status) {
      return "duplicate" as const;
    }
    await ctx.db.patch("automationEvents", event._id, {
      status,
      lastError:
        status === "failed"
          ? sanitiseError(error ?? "n8n could not send the email")
          : undefined,
      updatedAt: Date.now(),
    });
    return "updated" as const;
  },
});
