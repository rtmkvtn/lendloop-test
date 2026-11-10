import { httpRouter } from "convex/server";
import { internal } from "./_generated/api";
import type { ActionCtx } from "./_generated/server";
import { n8nToConvexSecret } from "./lib/env";
import { httpAction } from "./lib/functions";
import { verifyRequest } from "./lib/signature";

const http = httpRouter();

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });

// Only n8n calls these routes, so none runs its handler before the signature checks out.
const signedRoute = (
  handler: (ctx: ActionCtx, body: string) => Promise<Response>,
) =>
  httpAction(async (ctx, req) => {
    const secret = n8nToConvexSecret();
    if (!secret) return json(500, { error: "not configured" });
    const verified = await verifyRequest(secret, req);
    if (!verified.ok) return json(401, { error: "unauthorized" });
    return await handler(ctx, verified.body);
  });

function parseObject(raw: string): Record<string, unknown> | null {
  try {
    const body: unknown = JSON.parse(raw);
    return typeof body === "object" && body !== null
      ? (body as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

function parseWriteBack(raw: string) {
  const body = parseObject(raw);
  if (!body) return null;
  const { eventId, status, error } = body;
  if (typeof eventId !== "string" || !eventId) return null;
  if (status !== "sent" && status !== "failed") return null;
  if (error !== undefined && typeof error !== "string") return null;
  return { eventId, status, error } as const;
}

http.route({
  path: "/automation/notifications",
  method: "POST",
  handler: signedRoute(async (ctx, body) => {
    const writeBack = parseWriteBack(body);
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
  const body = parseObject(raw);
  if (!body) return null;
  const { reminderKey, status, error } = body;
  if (typeof reminderKey !== "string" || !reminderKey) return null;
  if (status !== "sent" && status !== "failed") return null;
  if (error !== undefined && typeof error !== "string") return null;
  return { reminderKey, status, error } as const;
}

http.route({
  path: "/automation/overdue-loans",
  method: "GET",
  handler: signedRoute(async (ctx) =>
    json(200, await ctx.runMutation(internal.reminders.overdueLoans)),
  ),
});

http.route({
  path: "/automation/reminders",
  method: "POST",
  handler: signedRoute(async (ctx, body) => {
    const writeBack = parseReminderWriteBack(body);
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
  const body = parseObject(raw);
  if (!body) return null;
  const { executionId, error, workflowName, failedNode, executionUrl } = body;
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
  handler: signedRoute(async (ctx, body) => {
    const failure = parseExecutionFailure(body);
    if (!failure) return json(400, { error: "invalid body" });
    const result = await ctx.runMutation(
      internal.automation.recordExecutionFailure,
      failure,
    );
    return json(200, { ok: true, duplicate: result === "duplicate" });
  }),
});

export default http;
