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

export default http;
