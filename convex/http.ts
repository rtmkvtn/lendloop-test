import { httpRouter } from "convex/server";
import { internal } from "./_generated/api";
import { n8nToConvexSecret } from "./lib/env";
import { httpAction } from "./lib/functions";
import { verifyRequest } from "./lib/signature";

const http = httpRouter();

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });

function parseWriteBack(raw: string) {
  let body: unknown;
  try {
    body = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof body !== "object" || body === null) return null;
  const { eventId, status, error } = body as Record<string, unknown>;
  if (typeof eventId !== "string" || !eventId) return null;
  if (status !== "sent" && status !== "failed") return null;
  if (error !== undefined && typeof error !== "string") return null;
  return { eventId, status, error } as const;
}

http.route({
  path: "/automation/notifications",
  method: "POST",
  handler: httpAction(async (ctx, req) => {
    const secret = n8nToConvexSecret();
    if (!secret) return json(500, { error: "not configured" });
    const verified = await verifyRequest(secret, req);
    if (!verified.ok) return json(401, { error: "unauthorized" });

    const writeBack = parseWriteBack(verified.body);
    if (!writeBack) return json(400, { error: "invalid body" });
    const result = await ctx.runMutation(
      internal.notifications.recordWriteBack,
      writeBack,
    );
    if (result === "not_found") return json(404, { error: "unknown event" });
    return json(200, { ok: true, result });
  }),
});

function parseReminderWriteBack(raw: string) {
  let body: unknown;
  try {
    body = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof body !== "object" || body === null) return null;
  const { reminderKey, status, error } = body as Record<string, unknown>;
  if (typeof reminderKey !== "string" || !reminderKey) return null;
  if (status !== "sent" && status !== "failed") return null;
  if (error !== undefined && typeof error !== "string") return null;
  return { reminderKey, status, error } as const;
}

http.route({
  path: "/automation/overdue-loans",
  method: "GET",
  handler: httpAction(async (ctx, req) => {
    const secret = n8nToConvexSecret();
    if (!secret) return json(500, { error: "not configured" });
    const verified = await verifyRequest(secret, req);
    if (!verified.ok) return json(401, { error: "unauthorized" });
    return json(200, await ctx.runMutation(internal.reminders.overdueLoans));
  }),
});

http.route({
  path: "/automation/reminders",
  method: "POST",
  handler: httpAction(async (ctx, req) => {
    const secret = n8nToConvexSecret();
    if (!secret) return json(500, { error: "not configured" });
    const verified = await verifyRequest(secret, req);
    if (!verified.ok) return json(401, { error: "unauthorized" });

    const writeBack = parseReminderWriteBack(verified.body);
    if (!writeBack) return json(400, { error: "invalid body" });
    const result = await ctx.runMutation(
      internal.reminders.recordWriteBack,
      writeBack,
    );
    if (result === "invalid") return json(400, { error: "invalid body" });
    return json(200, { ok: true, duplicate: result === "duplicate" });
  }),
});

function parseExecutionFailure(raw: string) {
  let body: unknown;
  try {
    body = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof body !== "object" || body === null) return null;
  const { executionId, error, workflowName, failedNode, executionUrl } =
    body as Record<string, unknown>;
  if (typeof executionId !== "string" || !executionId.trim()) return null;
  if (executionId.length > 64 || typeof error !== "string") return null;
  const optional = { workflowName, failedNode, executionUrl };
  for (const value of Object.values(optional)) {
    if (value !== undefined && typeof value !== "string") return null;
  }
  return {
    executionId: executionId.trim(),
    error,
    ...(optional as Record<keyof typeof optional, string | undefined>),
  };
}

http.route({
  path: "/automation/errors",
  method: "POST",
  handler: httpAction(async (ctx, req) => {
    const secret = n8nToConvexSecret();
    if (!secret) return json(500, { error: "not configured" });
    const verified = await verifyRequest(secret, req);
    if (!verified.ok) return json(401, { error: "unauthorized" });

    const failure = parseExecutionFailure(verified.body);
    if (!failure) return json(400, { error: "invalid body" });
    const result = await ctx.runMutation(
      internal.automation.recordExecutionFailure,
      failure,
    );
    return json(200, { ok: true, duplicate: result === "duplicate" });
  }),
});

export default http;
