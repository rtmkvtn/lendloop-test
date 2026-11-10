import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { api, internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { signedHeaders, verifySignature } from "./lib/signature";
import {
  ANNA,
  BEN,
  newTest,
  seedViewer,
  type TestConvex,
} from "./testing.helpers";

const C2N = "c2n-test-secret";
const N2C = "n2c-test-secret";
const WEBHOOK = "http://n8n:5678/webhook/lendloop/request-event";
const WRITE_BACK = "/automation/notifications";

const drill = {
  name: "Cordless drill",
  category: "power_tools" as const,
  condition: "good" as const,
  description: "18V, two batteries.",
};

type Call = { url: string; init: RequestInit };
let calls: Call[];
let respond: (call: Call) => Promise<Response>;

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-11-10T12:00:00Z"));
  vi.stubEnv("CONVEX_TO_N8N_SECRET", C2N);
  vi.stubEnv("N8N_TO_CONVEX_SECRET", N2C);
  vi.stubEnv("N8N_NOTIFY_WEBHOOK_URL", WEBHOOK);
  vi.stubEnv("APP_URL", "http://localhost:3000");
  calls = [];
  respond = async () => new Response(null, { status: 202 });
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init: RequestInit) => {
      const call = { url: String(url), init };
      calls.push(call);
      return await respond(call);
    }),
  );
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

async function circle() {
  const t = newTest();
  const anna = await seedViewer(t, ANNA);
  const ben = await seedViewer(t, BEN);
  const toolId = await anna.as.mutation(api.tools.create, drill);
  const requestId = await ben.as.mutation(api.requests.create, {
    toolId,
    startDate: "2026-11-12",
    endDate: "2026-11-14",
  });
  return { t, anna, ben, toolId, requestId };
}

const events = (t: TestConvex) =>
  t.run((ctx) => ctx.db.query("automationEvents").collect());

async function eventFor(t: TestConvex, key: string) {
  const event = (await events(t)).find((e) => e.idempotencyKey === key);
  if (!event) throw new Error(`no event ${key}`);
  return event;
}

const runScheduled = (t: TestConvex) =>
  t.finishAllScheduledFunctions(vi.runAllTimers);

async function deliveryDelaysSeconds(t: TestConvex) {
  const jobs = await t.run((ctx) =>
    ctx.db.system.query("_scheduled_functions").collect(),
  );
  const times = jobs
    .filter((j) => j.name.includes("deliver"))
    .map((j) => j.scheduledTime)
    .sort((a, b) => a - b);
  return times.slice(1).map((at, i) => Math.round((at - times[i]!) / 1000));
}

const bodyOf = (call: Call) => JSON.parse(String(call.init.body));

async function writeBack(
  t: TestConvex,
  body: unknown,
  { secret = N2C, now = Date.now() } = {},
) {
  const raw = typeof body === "string" ? body : JSON.stringify(body);
  const headers = await signedHeaders(
    secret,
    { method: "POST", path: WRITE_BACK, body: raw },
    now,
  );
  return await t.fetch(WRITE_BACK, { method: "POST", body: raw, headers });
}

describe("the Notification outbox", () => {
  test("requests.create queues one pending Notification for the Lender", async () => {
    const { t, anna, requestId } = await circle();
    expect(await events(t)).toEqual([
      expect.objectContaining({
        requestId,
        kind: "notification",
        event: "request.created",
        idempotencyKey: `notify:${requestId}:request.created`,
        recipientId: anna.userId,
        status: "pending",
        attempts: 0,
      }),
    ]);
  });

  test.each([
    ["approve", "request.approved", "borrower"],
    ["decline", "request.declined", "borrower"],
    ["cancel", "request.cancelled", "lender"],
  ] as const)("%s queues %s for the %s", async (action, event, recipient) => {
    const { t, anna, ben, requestId } = await circle();
    const actor = action === "cancel" ? ben : anna;
    await actor.as.mutation(api.requests[action], { requestId });
    expect(await eventFor(t, `notify:${requestId}:${event}`)).toMatchObject({
      event,
      status: "pending",
      recipientId: recipient === "lender" ? anna.userId : ben.userId,
    });
  });

  test("markReturned queues request.returned for the Borrower", async () => {
    const { t, anna, ben, requestId } = await circle();
    await anna.as.mutation(api.requests.approve, { requestId });
    await anna.as.mutation(api.requests.markReturned, { requestId });
    expect(
      await eventFor(t, `notify:${requestId}:request.returned`),
    ).toMatchObject({ recipientId: ben.userId });
  });

  test("removing a Tool queues request.auto_declined for each pending Borrower", async () => {
    const { t, anna, ben, toolId, requestId } = await circle();
    await anna.as.mutation(api.tools.remove, { toolId });
    expect(
      await eventFor(t, `notify:${requestId}:request.auto_declined`),
    ).toMatchObject({ recipientId: ben.userId });
  });

  test("a rejected transition queues nothing", async () => {
    const { t, anna, requestId } = await circle();
    await anna.as.mutation(api.requests.decline, { requestId });
    await expect(
      anna.as.mutation(api.requests.approve, { requestId }),
    ).rejects.toMatchObject({ data: { code: "CONFLICT" } });
    expect((await events(t)).map((e) => e.event)).toEqual([
      "request.created",
      "request.declined",
    ]);
  });
});

describe("delivery to n8n", () => {
  test("POSTs the minimal payload, signed with CONVEX_TO_N8N_SECRET, as raw bytes", async () => {
    const { t, requestId } = await circle();
    await runScheduled(t);

    expect(calls).toHaveLength(1);
    const [call] = calls as [Call];
    const event = await eventFor(t, `notify:${requestId}:request.created`);
    expect(call.url).toBe(WEBHOOK);
    expect(call.init.method).toBe("POST");
    expect(bodyOf(call)).toEqual({
      eventId: event._id,
      deliveryId: `${event._id}#0`,
      sentAt: expect.stringMatching(/^2026-11-10T12:00:00/),
      event: "request.created",
      recipient: { email: "anna@example.com", firstName: "Anna" },
      tool: { name: "Cordless drill" },
      dates: { start: "2026-11-12", end: "2026-11-14" },
      link: `http://localhost:3000/incoming?request=${requestId}`,
    });

    const headers = new Headers(call.init.headers);
    expect(headers.get("content-type")).toBe("application/json");
    expect(
      await verifySignature({
        secret: C2N,
        method: "POST",
        path: "/webhook/lendloop/request-event",
        body: String(call.init.body),
        timestamp: headers.get("x-lendloop-timestamp"),
        signature: headers.get("x-lendloop-signature"),
      }),
    ).toBe(true);
    expect(call.init.signal).toBeInstanceOf(AbortSignal);
  });

  test("links the Borrower to My requests", async () => {
    const { t, anna, requestId } = await circle();
    await anna.as.mutation(api.requests.approve, { requestId });
    await runScheduled(t);
    const approval = calls
      .map(bodyOf)
      .find((b) => b.event === "request.approved");
    expect(approval).toMatchObject({
      recipient: { email: "ben@example.com", firstName: "Ben" },
      link: `http://localhost:3000/requests?request=${requestId}`,
    });
  });

  test("202 marks the event accepted", async () => {
    const { t, requestId } = await circle();
    await runScheduled(t);
    expect(
      await eventFor(t, `notify:${requestId}:request.created`),
    ).toMatchObject({ status: "accepted", attempts: 1 });
  });

  test("a repeated event id gives one delivery", async () => {
    const { t, requestId } = await circle();
    await runScheduled(t);
    const event = await eventFor(t, `notify:${requestId}:request.created`);
    await t.action(internal.notifications.deliver, { eventId: event._id });
    await t.action(internal.notifications.deliver, { eventId: event._id });
    expect(calls).toHaveLength(1);
  });

  test("5xx retries after 30 s, 2 min, 10 min and 1 h, then fails after 5 attempts", async () => {
    respond = async () => new Response("boom", { status: 503 });
    const { t, requestId } = await circle();
    await runScheduled(t);

    expect(calls).toHaveLength(5);
    expect(await deliveryDelaysSeconds(t)).toEqual([30, 120, 600, 3600]);
    expect(
      await eventFor(t, `notify:${requestId}:request.created`),
    ).toMatchObject({
      status: "failed",
      attempts: 5,
      lastError: "n8n answered 503",
    });
  });

  test("keeps the event pending with the error while it retries", async () => {
    respond = async () => new Response(null, { status: 500 });
    const { t, requestId } = await circle();
    vi.runOnlyPendingTimers();
    await t.finishInProgressScheduledFunctions();
    expect(
      await eventFor(t, `notify:${requestId}:request.created`),
    ).toMatchObject({
      status: "pending",
      attempts: 1,
      lastError: "n8n answered 500",
    });
  });

  test.each([
    ["a network error", () => Promise.reject(new TypeError("fetch failed"))],
    [
      "a 10 s timeout",
      () =>
        Promise.reject(
          new DOMException("The operation timed out.", "TimeoutError"),
        ),
    ],
  ])("%s is retried", async (_label, failure) => {
    let first = true;
    respond = async () => {
      if (first) {
        first = false;
        return await failure();
      }
      return new Response(null, { status: 202 });
    };
    const { t, requestId } = await circle();
    await runScheduled(t);
    expect(calls).toHaveLength(2);
    expect(await deliveryDelaysSeconds(t)).toEqual([30]);
    expect(
      await eventFor(t, `notify:${requestId}:request.created`),
    ).toMatchObject({ status: "accepted", attempts: 2 });
  });

  test.each([401, 400, 404])(
    "%s fails at once without a retry",
    async (status) => {
      respond = async () => new Response(null, { status });
      const { t, requestId } = await circle();
      await runScheduled(t);
      expect(calls).toHaveLength(1);
      expect(
        await eventFor(t, `notify:${requestId}:request.created`),
      ).toMatchObject({
        status: "failed",
        attempts: 1,
        lastError: `n8n answered ${status}`,
      });
    },
  );

  test("a write-back that beats the 202 is not overwritten by accepted", async () => {
    const stack: { t?: TestConvex } = {};
    respond = async (call) => {
      const { eventId } = bodyOf(call);
      await writeBack(stack.t!, { eventId, status: "sent" });
      return new Response(null, { status: 202 });
    };
    const { t, requestId } = await circle();
    stack.t = t;
    await runScheduled(t);
    expect(
      await eventFor(t, `notify:${requestId}:request.created`),
    ).toMatchObject({ status: "sent" });
  });
});

describe("POST /automation/notifications (n8n write-back)", () => {
  async function accepted() {
    const made = await circle();
    await runScheduled(made.t);
    const event = await eventFor(
      made.t,
      `notify:${made.requestId}:request.created`,
    );
    return { ...made, eventId: event._id as Id<"automationEvents"> };
  }

  const statusOf = async (t: TestConvex, id: Id<"automationEvents">) =>
    (await t.run((ctx) => ctx.db.get("automationEvents", id)))!;

  test("a signed sent marks the event sent", async () => {
    const { t, eventId } = await accepted();
    const res = await writeBack(t, { eventId, status: "sent" });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, result: "updated" });
    expect(await statusOf(t, eventId)).toMatchObject({ status: "sent" });
  });

  test("is idempotent by eventId", async () => {
    const { t, eventId } = await accepted();
    await writeBack(t, { eventId, status: "sent" });
    const again = await writeBack(t, { eventId, status: "sent" });
    expect(again.status).toBe(200);
    expect(await again.json()).toEqual({ ok: true, result: "duplicate" });
    const late = await writeBack(t, { eventId, status: "failed", error: "x" });
    expect(await late.json()).toEqual({ ok: true, result: "duplicate" });
    expect(await statusOf(t, eventId)).toMatchObject({ status: "sent" });
  });

  test("failed stores a sanitised error", async () => {
    const { t, eventId } = await accepted();
    const res = await writeBack(t, {
      eventId,
      status: "failed",
      error: `connect ECONNREFUSED to anna@example.com\n${"x".repeat(500)}`,
    });
    expect(res.status).toBe(200);
    const event = await statusOf(t, eventId);
    expect(event.status).toBe("failed");
    expect(event.lastError).not.toContain("anna@example.com");
    expect(event.lastError).toMatch(/^connect ECONNREFUSED to \[email\] x+/);
    expect(event.lastError!.length).toBeLessThanOrEqual(200);
  });

  test("a sent after failed wins", async () => {
    const { t, eventId } = await accepted();
    await writeBack(t, { eventId, status: "failed", error: "smtp down" });
    await writeBack(t, { eventId, status: "sent" });
    expect(await statusOf(t, eventId)).toMatchObject({
      status: "sent",
    });
  });

  test.each([
    ["unsigned", { headers: {} }],
    ["signed with the Convex → n8n secret", { secret: C2N }],
    ["stale", { now: Date.parse("2026-11-10T11:54:59Z") }],
    ["from the future", { now: Date.parse("2026-11-10T12:05:01Z") }],
  ])("rejects a write-back that is %s with 401", async (label, opts) => {
    const { t, eventId } = await accepted();
    const body = JSON.stringify({ eventId, status: "sent" });
    const res =
      label === "unsigned"
        ? await t.fetch(WRITE_BACK, { method: "POST", body })
        : await writeBack(t, body, opts as { secret?: string; now?: number });
    expect(res.status).toBe(401);
    expect(await statusOf(t, eventId)).toMatchObject({ status: "accepted" });
  });

  test("rejects a tampered body with 401", async () => {
    const { t, eventId } = await accepted();
    const signedBody = JSON.stringify({ eventId, status: "failed" });
    const headers = await signedHeaders(N2C, {
      method: "POST",
      path: WRITE_BACK,
      body: signedBody,
    });
    const res = await t.fetch(WRITE_BACK, {
      method: "POST",
      headers,
      body: JSON.stringify({ eventId, status: "sent" }),
    });
    expect(res.status).toBe(401);
  });

  test.each([
    ["not JSON", "{"],
    ["an unknown status", { status: "delivered" }],
    ["no eventId", { status: "sent" }],
  ])("rejects %s with 400", async (_label, body) => {
    const { t, eventId } = await accepted();
    const payload = typeof body === "string" ? body : { eventId, ...body };
    if (_label === "no eventId")
      delete (payload as { eventId?: string }).eventId;
    const res = await writeBack(t, payload);
    expect(res.status).toBe(400);
  });

  test("answers 404 for an unknown eventId", async () => {
    const { t } = await accepted();
    const res = await writeBack(t, { eventId: "nope", status: "sent" });
    expect(res.status).toBe(404);
  });
});

describe("activity", () => {
  test("each Request row shows its latest automation event", async () => {
    const { t, anna, ben, requestId } = await circle();
    await runScheduled(t);
    const created = await eventFor(t, `notify:${requestId}:request.created`);
    await writeBack(t, { eventId: created._id, status: "sent" });
    const [incoming] = await anna.as.query(api.requests.listIncoming, {});
    expect(incoming?.activity).toMatchObject({
      label: "Request email to lender sent",
      failed: false,
    });

    await anna.as.mutation(api.requests.approve, { requestId });
    const [mine] = await ben.as.query(api.requests.listMine, {});
    expect(mine?.activity).toMatchObject({
      label: "Approval email to borrower queued",
      failed: false,
    });
  });

  test("a failed email shows as failed, and a retrying one as retrying", async () => {
    respond = async () => new Response(null, { status: 500 });
    const { t, ben } = await circle();
    vi.runOnlyPendingTimers();
    await t.finishInProgressScheduledFunctions();
    const [row] = await ben.as.query(api.requests.listMine, {});
    expect(row?.activity).toMatchObject({
      label: "Request email to lender failed, retrying",
      failed: true,
    });

    await runScheduled(t);
    const [after] = await ben.as.query(api.requests.listMine, {});
    expect(after?.activity).toMatchObject({
      label: "Request email to lender failed",
      failed: true,
    });
  });

  test("requests.get merges automation events into the timeline", async () => {
    const { t, anna, requestId } = await circle();
    await runScheduled(t);
    vi.setSystemTime(new Date("2026-11-10T13:00:00Z"));
    await anna.as.mutation(api.requests.approve, { requestId });
    const detail = await anna.as.query(api.requests.get, { requestId });
    expect(detail.history.map((h) => h.label)).toEqual([
      "Requested",
      "Request email to lender handed to n8n",
      "Approved",
      "Approval email to borrower queued",
    ]);
  });
});
