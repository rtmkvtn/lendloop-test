import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { api, internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import { signedHeaders } from "./lib/signature";
import {
  ANNA,
  BEN,
  OMAR,
  newTest,
  seedViewer,
  type TestConvex,
} from "./testing.helpers";

const C2N = "c2n-test-secret";
const N2C = "n2c-test-secret";
const ERRORS = "/automation/errors";

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-11-10T12:00:00Z"));
  vi.stubEnv("CONVEX_TO_N8N_SECRET", C2N);
  vi.stubEnv("N8N_TO_CONVEX_SECRET", N2C);
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

const events = (t: TestConvex) =>
  t.run((ctx) => ctx.db.query("automationEvents").collect());

async function postError(
  t: TestConvex,
  body: unknown,
  { secret = N2C, now = Date.now() } = {},
) {
  const raw = typeof body === "string" ? body : JSON.stringify(body);
  const headers = await signedHeaders(
    secret,
    { method: "POST", path: ERRORS, body: raw },
    now,
  );
  return await t.fetch(ERRORS, { method: "POST", body: raw, headers });
}

const FAILURE = {
  executionId: "4711",
  workflowName: "LendLoop: overdue reminders",
  failedNode: "Write back",
  executionUrl:
    "http://localhost:5678/workflow/llReminderWf0001/executions/4711",
  error: "Request failed with status code 500 for ben@example.com",
};

describe("POST /automation/errors (Error Workflow)", () => {
  test("records one workflow_error keyed by execution id, without addresses", async () => {
    const t = newTest();
    const res = await postError(t, FAILURE);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, duplicate: false });
    expect(await events(t)).toEqual([
      expect.objectContaining({
        kind: "workflow_error",
        event: "n8n.execution_failed",
        idempotencyKey: "workflow_error:n8n:4711",
        status: "failed",
        attempts: 1,
        workflowName: FAILURE.workflowName,
        failedNode: "Write back",
        executionUrl: FAILURE.executionUrl,
        lastError: "Request failed with status code 500 for [email]",
      }),
    ]);
  });

  test("the same execution posted twice gives one row and a duplicate", async () => {
    const t = newTest();
    await postError(t, FAILURE);
    const res = await postError(t, { ...FAILURE, error: "again" });
    expect(await res.json()).toEqual({ ok: true, duplicate: true });
    const rows = await events(t);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.lastError).toContain("status code 500");
  });

  test("keeps internal hosts out of the stored error", async () => {
    const t = newTest();
    await postError(t, {
      ...FAILURE,
      error:
        "The connection to http://convex-backend:3211/automation/reminders was refused: connect ECONNREFUSED 172.21.0.3:3211",
    });
    const [row] = await events(t);
    expect(row!.lastError).toBe(
      "The connection to [url] was refused: connect ECONNREFUSED [host]",
    );
  });

  test("drops an execution link that isn't http(s)", async () => {
    const t = newTest();
    await postError(t, { ...FAILURE, executionUrl: "javascript:alert(1)" });
    const [row] = await events(t);
    expect(row!.executionUrl).toBeUndefined();
  });

  test.each([
    ["the Convex → n8n secret", { secret: C2N }],
    ["a stale timestamp", { now: Date.now() - 400_000 }],
  ])("rejects a POST signed with %s with 401", async (_label, options) => {
    const t = newTest();
    const res = await postError(t, FAILURE, options);
    expect(res.status).toBe(401);
    expect(await events(t)).toEqual([]);
  });

  test("rejects a tampered body with 401", async () => {
    const t = newTest();
    const raw = JSON.stringify(FAILURE);
    const headers = await signedHeaders(N2C, {
      method: "POST",
      path: ERRORS,
      body: raw,
    });
    const res = await t.fetch(ERRORS, {
      method: "POST",
      body: raw.replace("4711", "4712"),
      headers,
    });
    expect(res.status).toBe(401);
    expect(await events(t)).toEqual([]);
  });

  test.each([
    ["no executionId", { ...FAILURE, executionId: "" }],
    ["a non-string error", { ...FAILURE, error: 42 }],
    ["not JSON", "{"],
  ])("answers 400 for %s", async (_label, body) => {
    const t = newTest();
    const res = await postError(t, body);
    expect(res.status).toBe(400);
    expect(await events(t)).toEqual([]);
  });
});

const MIN = 60_000;
const NOTIFY_WEBHOOK = "http://n8n:5678/webhook/lendloop/request-event";
const REMINDERS_WEBHOOK = "http://n8n:5678/webhook/reminders/run";

type Call = { url: string; init: RequestInit };

function stubN8n(
  respond: () => Promise<Response> = async () =>
    new Response(null, { status: 202 }),
) {
  const calls: Call[] = [];
  vi.stubEnv("N8N_NOTIFY_WEBHOOK_URL", NOTIFY_WEBHOOK);
  vi.stubEnv("N8N_REMINDERS_WEBHOOK_URL", REMINDERS_WEBHOOK);
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init: RequestInit) => {
      calls.push({ url: String(url), init });
      return await respond();
    }),
  );
  return calls;
}

async function circle() {
  const t = newTest();
  const anna = await seedViewer(t, ANNA);
  const ben = await seedViewer(t, BEN);
  const omar = await seedViewer(t, OMAR);
  const toolId = await t.run((ctx) =>
    ctx.db.insert("tools", {
      ownerId: anna.userId,
      name: "Cordless drill",
      category: "power_tools",
      condition: "good",
      description: "18V, two batteries.",
    }),
  );
  const loan = (
    endDate: string,
    status: "approved" | "returned" = "approved",
  ) =>
    t.run((ctx) =>
      ctx.db.insert("requests", {
        toolId,
        borrowerId: ben.userId,
        lenderId: anna.userId,
        startDate: "2026-11-01",
        endDate,
        status,
      }),
    );
  const event = (row: Partial<Doc<"automationEvents">>) =>
    t.run((ctx) =>
      ctx.db.insert("automationEvents", {
        kind: "notification",
        event: "request.created",
        idempotencyKey: `key-${Math.random()}`,
        recipientId: anna.userId,
        status: "accepted",
        attempts: 1,
        updatedAt: Date.now(),
        ...row,
      }),
    );
  return { t, anna, ben, omar, toolId, loan, event };
}

const get = (t: TestConvex, id: Id<"automationEvents">) =>
  t.run((ctx) => ctx.db.get("automationEvents", id));

describe("the stuck-event cron", () => {
  test("marks events accepted for over 30 minutes failed with no confirmation from n8n", async () => {
    const { t, event } = await circle();
    const stuck = await event({ updatedAt: Date.now() - 31 * MIN });
    const fresh = await event({ updatedAt: Date.now() - 29 * MIN });
    const sent = await event({ status: "sent", updatedAt: 0 });

    await t.mutation(internal.automation.markStuckEvents, {});

    expect(await get(t, stuck)).toMatchObject({
      status: "failed",
      lastError: "No confirmation from n8n",
    });
    expect(await get(t, fresh)).toMatchObject({ status: "accepted" });
    expect(await get(t, sent)).toMatchObject({ status: "sent" });
  });

  test("also fails a retried Reminder that n8n never wrote back", async () => {
    const { t, event, loan } = await circle();
    const requestId = await loan("2026-11-07");
    const reminder = await event({
      kind: "reminder",
      event: "reminder.overdue",
      requestId,
      status: "pending",
      updatedAt: Date.now() - 31 * MIN,
    });
    const notification = await event({
      status: "pending",
      updatedAt: Date.now() - 31 * MIN,
    });

    await t.mutation(internal.automation.markStuckEvents, {});

    expect(await get(t, reminder)).toMatchObject({ status: "failed" });
    // Pending Notifications are still owned by the delivery backoff.
    expect(await get(t, notification)).toMatchObject({ status: "pending" });
  });
});

describe("the missed-run cron", () => {
  const missed = (t: TestConvex) =>
    t.run((ctx) =>
      ctx.db
        .query("automationEvents")
        .withIndex("by_kind_updatedAt", (q) => q.eq("kind", "workflow_error"))
        .collect(),
    );
  const ranAt = (t: TestConvex, at: number) =>
    t.run((ctx) =>
      ctx.db.insert("automationState", {
        key: "reminders",
        lastReminderRunAt: at,
      }),
    );

  test("records Reminder run missed once when Loans are Overdue and no run happened today", async () => {
    vi.setSystemTime(new Date("2026-11-10T10:05:00Z"));
    const { t, loan } = await circle();
    await loan("2026-11-07");
    await ranAt(t, Date.parse("2026-11-09T09:00:00Z"));

    await t.mutation(internal.automation.checkMissedReminderRun, {});
    await t.mutation(internal.automation.checkMissedReminderRun, {});

    expect(await missed(t)).toEqual([
      expect.objectContaining({
        event: "reminders.missed_run",
        idempotencyKey: "workflow_error:missed_run:2026-11-10",
        status: "failed",
        lastError: "Reminder run missed",
      }),
    ]);
  });

  test("records it when the reminder run has never happened", async () => {
    vi.setSystemTime(new Date("2026-11-10T10:05:00Z"));
    const { t, loan } = await circle();
    await loan("2026-11-07");
    await t.mutation(internal.automation.checkMissedReminderRun, {});
    expect(await missed(t)).toHaveLength(1);
  });

  test("stays quiet when today's run happened", async () => {
    vi.setSystemTime(new Date("2026-11-10T10:05:00Z"));
    const { t, loan } = await circle();
    await loan("2026-11-07");
    await ranAt(t, Date.parse("2026-11-10T09:00:00Z"));
    await t.mutation(internal.automation.checkMissedReminderRun, {});
    expect(await missed(t)).toEqual([]);
  });

  test("stays quiet when no Loan is Overdue", async () => {
    vi.setSystemTime(new Date("2026-11-10T10:05:00Z"));
    const { t, loan } = await circle();
    await loan("2026-11-10");
    await loan("2026-11-01", "returned");
    await t.mutation(internal.automation.checkMissedReminderRun, {});
    expect(await missed(t)).toEqual([]);
  });

  test("judges 10:00 and today in APP_TIMEZONE, not UTC", async () => {
    vi.stubEnv("APP_TIMEZONE", "America/New_York");
    // 10:05 UTC is 05:05 in New York, before the 09:00 run is due.
    vi.setSystemTime(new Date("2026-11-10T10:05:00Z"));
    const { t, loan } = await circle();
    await loan("2026-11-07");
    await ranAt(t, Date.parse("2026-11-09T14:00:00Z"));
    await t.mutation(internal.automation.checkMissedReminderRun, {});
    expect(await missed(t)).toEqual([]);

    vi.setSystemTime(new Date("2026-11-10T15:05:00Z"));
    await t.mutation(internal.automation.checkMissedReminderRun, {});
    expect(await missed(t)).toEqual([
      expect.objectContaining({
        idempotencyKey: "workflow_error:missed_run:2026-11-10",
      }),
    ]);
  });
});

describe("admin.retryEvent", () => {
  const audit = (t: TestConvex) =>
    t.run((ctx) => ctx.db.query("auditLog").collect());

  test("re-delivers a failed Notification under the same idempotency key with a new deliveryId", async () => {
    const calls = stubN8n();
    const { t, omar, event, loan } = await circle();
    const requestId = await loan("2026-11-12");
    const id = await event({
      requestId,
      idempotencyKey: `notify:${requestId}:request.created`,
      status: "failed",
      attempts: 5,
      lastError: "n8n answered 503",
    });

    await omar.as.mutation(api.admin.retryEvent, { eventId: id });
    const retried = await get(t, id);
    expect(retried).toMatchObject({
      status: "pending",
      attempts: 0,
      retryGeneration: 1,
    });
    expect(retried!.lastError).toBeUndefined();
    expect(await audit(t)).toEqual([
      expect.objectContaining({
        actorId: omar.userId,
        action: "automation.retried",
        target: id,
      }),
    ]);

    await t.finishAllScheduledFunctions(vi.runAllTimers);
    expect(calls).toHaveLength(1);
    expect(JSON.parse(String(calls[0]!.init.body))).toMatchObject({
      eventId: id,
      deliveryId: `${id}#1`,
    });
    const rows = await events(t);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      idempotencyKey: `notify:${requestId}:request.created`,
      status: "accepted",
    });
  });

  test("retrying twice before n8n answers sends one delivery", async () => {
    const calls = stubN8n();
    const { t, omar, event, loan } = await circle();
    const requestId = await loan("2026-11-12");
    const id = await event({ requestId, status: "failed" });
    await omar.as.mutation(api.admin.retryEvent, { eventId: id });
    await expect(
      omar.as.mutation(api.admin.retryEvent, { eventId: id }),
    ).rejects.toMatchObject({ data: { code: "CONFLICT" } });
    await t.finishAllScheduledFunctions(vi.runAllTimers);
    expect(calls).toHaveLength(1);
    expect(await audit(t)).toHaveLength(1);
  });

  test("retries a tool.removed Notification by its toolId", async () => {
    const calls = stubN8n();
    const { t, omar, event, toolId } = await circle();
    await t.run((ctx) =>
      ctx.db.patch("tools", toolId, {
        removedAt: Date.now(),
        removalReason: "Recall",
      }),
    );
    const id = await event({
      toolId,
      event: "tool.removed",
      idempotencyKey: `notify:${toolId}:tool.removed`,
      status: "failed",
    });
    await omar.as.mutation(api.admin.retryEvent, { eventId: id });
    await t.finishAllScheduledFunctions(vi.runAllTimers);
    expect(JSON.parse(String(calls[0]!.init.body))).toMatchObject({
      event: "tool.removed",
      deliveryId: `${id}#1`,
      reason: "Recall",
    });
  });

  test("a stuck accepted event can be retried before the cron fails it", async () => {
    stubN8n();
    const { t, omar, event, loan } = await circle();
    const requestId = await loan("2026-11-12");
    const id = await event({ requestId, updatedAt: Date.now() - 31 * MIN });
    await omar.as.mutation(api.admin.retryEvent, { eventId: id });
    expect(await get(t, id)).toMatchObject({ status: "pending" });
  });

  test.each([
    ["sent", 0],
    ["accepted", 5 * MIN],
    ["pending", 0],
  ] as const)("rejects a %s event with CONFLICT", async (status, age) => {
    stubN8n();
    const { t, omar, event } = await circle();
    const id = await event({ status, updatedAt: Date.now() - age });
    await expect(
      omar.as.mutation(api.admin.retryEvent, { eventId: id }),
    ).rejects.toMatchObject({ data: { code: "CONFLICT" } });
    expect(await audit(t)).toEqual([]);
  });

  test("re-runs reminders for a failed Reminder, keeping its key", async () => {
    const calls = stubN8n();
    const { t, omar, event, loan } = await circle();
    const requestId = await loan("2026-11-07");
    const key = `reminder:${requestId}:2026-11-10`;
    const id = await event({
      kind: "reminder",
      event: "reminder.overdue",
      requestId,
      idempotencyKey: key,
      status: "failed",
      lastError: "connect ECONNREFUSED",
    });
    await omar.as.mutation(api.admin.retryEvent, { eventId: id });
    expect(await get(t, id)).toMatchObject({
      idempotencyKey: key,
      status: "pending",
      attempts: 1,
      retryGeneration: 1,
    });
    await t.finishAllScheduledFunctions(vi.runAllTimers);
    expect(calls.map((c) => c.url)).toEqual([REMINDERS_WEBHOOK]);
  });

  test("rejects a Reminder whose Loan was returned", async () => {
    stubN8n();
    const { t, omar, event, loan } = await circle();
    const requestId = await loan("2026-11-07", "returned");
    const id = await event({
      kind: "reminder",
      event: "reminder.overdue",
      requestId,
      status: "failed",
    });
    await expect(
      omar.as.mutation(api.admin.retryEvent, { eventId: id }),
    ).rejects.toMatchObject({ data: { code: "CONFLICT" } });
    expect(await get(t, id)).toMatchObject({ status: "failed" });
  });

  test("is forbidden for Members and signed-out callers", async () => {
    const calls = stubN8n();
    const { t, ben, event } = await circle();
    const id = await event({ status: "failed" });
    await expect(
      ben.as.mutation(api.admin.retryEvent, { eventId: id }),
    ).rejects.toMatchObject({ data: { code: "FORBIDDEN" } });
    await expect(
      t.mutation(api.admin.retryEvent, { eventId: id }),
    ).rejects.toMatchObject({ data: { code: "UNAUTHENTICATED" } });
    await t.finishAllScheduledFunctions(vi.runAllTimers);
    expect(calls).toEqual([]);
    expect(await get(t, id)).toMatchObject({ status: "failed" });
  });

  test("a workflow error is not retryable", async () => {
    const { t, omar } = await circle();
    await postError(t, FAILURE);
    const [row] = await events(t);
    await expect(
      omar.as.mutation(api.admin.retryEvent, { eventId: row!._id }),
    ).rejects.toMatchObject({ data: { code: "INVALID" } });
  });
});

describe("admin.automationHealth", () => {
  test("lists failed and stuck events, recent workflow errors and the last reminder run", async () => {
    const { t, omar, event, loan, toolId } = await circle();
    const requestId = await loan("2026-11-12");
    const failed = await event({
      requestId,
      status: "failed",
      lastError: "n8n answered 503",
      updatedAt: Date.now() - 2 * MIN,
    });
    const stuck = await event({
      requestId,
      event: "request.approved",
      updatedAt: Date.now() - 45 * MIN,
    });
    const removal = await event({
      toolId,
      event: "tool.removed",
      status: "failed",
      updatedAt: Date.now() - MIN,
    });
    await event({ requestId, status: "sent" });
    await event({ requestId, updatedAt: Date.now() - 5 * MIN });
    await postError(t, FAILURE);
    const ranAt = Date.parse("2026-11-10T09:00:00Z");
    await t.run((ctx) =>
      ctx.db.insert("automationState", {
        key: "reminders",
        lastReminderRunAt: ranAt,
      }),
    );

    const health = await omar.as.query(api.admin.automationHealth, {});
    expect(health.events).toEqual([
      expect.objectContaining({
        _id: removal,
        label: "Removal email to lender",
        toolName: "Cordless drill",
        status: "failed",
        stuck: false,
      }),
      expect.objectContaining({
        _id: failed,
        label: "Request email to lender",
        toolName: "Cordless drill",
        requestId,
        lastError: "n8n answered 503",
        stuck: false,
      }),
      expect.objectContaining({
        _id: stuck,
        label: "Approval email to borrower",
        status: "accepted",
        stuck: true,
      }),
    ]);
    expect(health.workflowErrors).toEqual([
      expect.objectContaining({
        workflowName: FAILURE.workflowName,
        failedNode: "Write back",
        executionUrl: FAILURE.executionUrl,
        message: "Request failed with status code 500 for [email]",
      }),
    ]);
    expect(health.lastReminderRunAt).toBe(ranAt);
    expect(JSON.stringify(health)).not.toContain("@example.com");
  });

  test("is Admin only", async () => {
    const { t, ben } = await circle();
    await expect(
      ben.as.query(api.admin.automationHealth, {}),
    ).rejects.toMatchObject({ data: { code: "FORBIDDEN" } });
    await expect(t.query(api.admin.automationHealth, {})).rejects.toMatchObject(
      { data: { code: "UNAUTHENTICATED" } },
    );
  });
});

describe("a failed manual reminder trigger", () => {
  test("records a workflow_error the Admin can see", async () => {
    stubN8n(async () => new Response(null, { status: 503 }));
    const { t, omar } = await circle();
    await omar.as.mutation(api.admin.runRemindersNow, {});
    await t.finishAllScheduledFunctions(vi.runAllTimers);
    const health = await omar.as.query(api.admin.automationHealth, {});
    expect(health.workflowErrors).toEqual([
      expect.objectContaining({
        event: "reminders.trigger_failed",
        message: "Could not start the reminder run: n8n answered 503",
      }),
    ]);
  });

  test("records it when n8n can't be reached", async () => {
    stubN8n(async () => Promise.reject(new TypeError("fetch failed")));
    const { t, omar } = await circle();
    await omar.as.mutation(api.admin.runRemindersNow, {});
    await t.finishAllScheduledFunctions(vi.runAllTimers);
    expect(await events(t)).toEqual([
      expect.objectContaining({
        kind: "workflow_error",
        lastError: "Could not start the reminder run: Could not reach n8n",
      }),
    ]);
  });
});
