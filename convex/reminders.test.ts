import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { api } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { signedHeaders, verifySignature } from "./lib/signature";
import {
  ANNA,
  BEN,
  CARA,
  OMAR,
  newTest,
  seedViewer,
  type TestConvex,
} from "./testing.helpers";

const C2N = "c2n-test-secret";
const N2C = "n2c-test-secret";
const OVERDUE = "/automation/overdue-loans";
const REMINDERS = "/automation/reminders";

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

async function circle() {
  const t = newTest();
  const anna = await seedViewer(t, ANNA);
  const ben = await seedViewer(t, BEN);
  const cara = await seedViewer(t, CARA);
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
    status: "approved" | "returned" | "pending" = "approved",
    borrowerId: Id<"users"> = ben.userId,
  ) =>
    t.run((ctx) =>
      ctx.db.insert("requests", {
        toolId,
        borrowerId,
        lenderId: anna.userId,
        startDate: "2026-11-01",
        endDate,
        status,
      }),
    );
  return { t, anna, ben, cara, toolId, loan };
}

async function signedGet(
  t: TestConvex,
  { secret = N2C, now = Date.now() } = {},
) {
  const headers = await signedHeaders(
    secret,
    { method: "GET", path: OVERDUE, body: "" },
    now,
  );
  return await t.fetch(OVERDUE, { method: "GET", headers });
}

async function overdue(t: TestConvex) {
  const res = await signedGet(t);
  expect(res.status).toBe(200);
  return (await res.json()) as {
    asOf: string;
    loans: Array<Record<string, unknown>>;
  };
}

async function writeBack(
  t: TestConvex,
  body: unknown,
  { secret = N2C, now = Date.now() } = {},
) {
  const raw = typeof body === "string" ? body : JSON.stringify(body);
  const headers = await signedHeaders(
    secret,
    { method: "POST", path: REMINDERS, body: raw },
    now,
  );
  return await t.fetch(REMINDERS, { method: "POST", body: raw, headers });
}

const reminders = (t: TestConvex) =>
  t.run((ctx) =>
    ctx.db
      .query("automationEvents")
      .filter((q) => q.eq(q.field("kind"), "reminder"))
      .collect(),
  );

describe("GET /automation/overdue-loans", () => {
  test("lists each Overdue Loan with its reminderKey and no Lender data", async () => {
    const { t, loan } = await circle();
    const loanId = await loan("2026-11-07");
    const body = await overdue(t);
    expect(body).toEqual({
      asOf: "2026-11-10",
      loans: [
        {
          loanId,
          reminderKey: `reminder:${loanId}:2026-11-10`,
          borrowerEmail: "ben@example.com",
          borrowerFirstName: "Ben",
          toolName: "Cordless drill",
          endDate: "2026-11-07",
          daysOverdue: 3,
        },
      ],
    });
    expect(JSON.stringify(body)).not.toMatch(/anna/i);
  });

  test("skips Loans ending today, returned Loans and pending Requests", async () => {
    const { t, loan } = await circle();
    await loan("2026-11-10");
    await loan("2026-11-11");
    await loan("2026-11-05", "returned");
    await loan("2026-11-05", "pending");
    const yesterday = await loan("2026-11-09");
    const body = await overdue(t);
    expect(body.loans.map((l) => [l.loanId, l.daysOverdue])).toEqual([
      [yesterday, 1],
    ]);
  });

  test.each([
    ["UTC", "2026-11-10T23:59:59Z", "2026-11-10", ["2026-11-09"]],
    ["UTC", "2026-11-11T00:00:00Z", "2026-11-11", ["2026-11-09", "2026-11-10"]],
    // 12:00 UTC is already 01:00 the next day in Auckland (NZDT, UTC+13).
    [
      "Pacific/Auckland",
      "2026-11-10T12:00:00Z",
      "2026-11-11",
      ["2026-11-09", "2026-11-10"],
    ],
    // 03:00 UTC is still 19:00 the day before in Los Angeles (PST, UTC-8).
    [
      "America/Los_Angeles",
      "2026-11-11T03:00:00Z",
      "2026-11-10",
      ["2026-11-09"],
    ],
  ])(
    "in %s at %s, asOf is %s and only earlier end dates are Overdue",
    async (zone, now, asOf, overdueEnds) => {
      vi.stubEnv("APP_TIMEZONE", zone);
      vi.setSystemTime(new Date(now));
      const { t, loan } = await circle();
      await loan("2026-11-09");
      await loan("2026-11-10");
      await loan("2026-11-11");
      const body = await overdue(t);
      expect(body.asOf).toBe(asOf);
      expect(body.loans.map((l) => l.endDate).sort()).toEqual(overdueEnds);
    },
  );

  test("leaves out Loans already reminded today, but lists failed ones again", async () => {
    const { t, loan, cara } = await circle();
    const sent = await loan("2026-11-07");
    const failed = await loan("2026-11-08", "approved", cara.userId);
    await writeBack(t, {
      reminderKey: `reminder:${sent}:2026-11-10`,
      status: "sent",
    });
    await writeBack(t, {
      reminderKey: `reminder:${failed}:2026-11-10`,
      status: "failed",
      error: "smtp down",
    });
    expect((await overdue(t)).loans.map((l) => l.loanId)).toEqual([failed]);
  });

  test("a Reminder sent yesterday does not cover today", async () => {
    const { t, loan } = await circle();
    const loanId = await loan("2026-11-07");
    await writeBack(t, {
      reminderKey: `reminder:${loanId}:2026-11-09`,
      status: "sent",
    });
    expect((await overdue(t)).loans.map((l) => l.loanId)).toEqual([loanId]);
  });

  test("records lastReminderRunAt", async () => {
    const { t } = await circle();
    const before = await t.run((ctx) =>
      ctx.db.query("automationState").collect(),
    );
    expect(before).toEqual([]);
    await overdue(t);
    vi.setSystemTime(new Date("2026-11-10T13:00:00Z"));
    await overdue(t);
    const state = await t.run((ctx) =>
      ctx.db.query("automationState").collect(),
    );
    expect(state).toEqual([
      expect.objectContaining({
        key: "reminders",
        lastReminderRunAt: Date.parse("2026-11-10T13:00:00Z"),
      }),
    ]);
  });

  test.each([
    ["unsigned", null],
    ["signed with the Convex → n8n secret", { secret: C2N }],
    ["stale", { now: Date.parse("2026-11-10T11:54:59Z") }],
    ["from the future", { now: Date.parse("2026-11-10T12:05:01Z") }],
  ])("rejects a GET that is %s with 401", async (_label, opts) => {
    const { t, loan } = await circle();
    await loan("2026-11-07");
    const res = opts
      ? await signedGet(t, opts)
      : await t.fetch(OVERDUE, { method: "GET" });
    expect(res.status).toBe(401);
    const state = await t.run((ctx) =>
      ctx.db.query("automationState").collect(),
    );
    expect(state).toEqual([]);
  });

  test("a signature over another path is rejected", async () => {
    const { t } = await circle();
    const headers = await signedHeaders(N2C, {
      method: "GET",
      path: REMINDERS,
      body: "",
    });
    const res = await t.fetch(OVERDUE, { method: "GET", headers });
    expect(res.status).toBe(401);
  });
});

describe("POST /automation/reminders (n8n write-back)", () => {
  test("a new reminderKey inserts one sent Reminder for the Borrower", async () => {
    const { t, loan, ben } = await circle();
    const loanId = await loan("2026-11-07");
    const reminderKey = `reminder:${loanId}:2026-11-10`;
    const res = await writeBack(t, { reminderKey, status: "sent" });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, duplicate: false });
    expect(await reminders(t)).toEqual([
      expect.objectContaining({
        requestId: loanId,
        kind: "reminder",
        idempotencyKey: reminderKey,
        recipientId: ben.userId,
        status: "sent",
        attempts: 1,
      }),
    ]);
  });

  test("written back twice gives one row and a duplicate", async () => {
    const { t, loan } = await circle();
    const reminderKey = `reminder:${await loan("2026-11-07")}:2026-11-10`;
    await writeBack(t, { reminderKey, status: "sent" });
    const again = await writeBack(t, { reminderKey, status: "sent" });
    expect(again.status).toBe(200);
    expect(await again.json()).toEqual({ ok: true, duplicate: true });
    const late = await writeBack(t, {
      reminderKey,
      status: "failed",
      error: "x",
    });
    expect(late.status).toBe(200);
    expect(await late.json()).toEqual({ ok: true, duplicate: true });
    expect(await reminders(t)).toEqual([
      expect.objectContaining({ status: "sent", attempts: 1 }),
    ]);
  });

  test("failed then sent gives one row with attempts 2", async () => {
    const { t, loan } = await circle();
    const reminderKey = `reminder:${await loan("2026-11-07")}:2026-11-10`;
    const failed = await writeBack(t, {
      reminderKey,
      status: "failed",
      error: "connect ECONNREFUSED for ben@example.com",
    });
    expect(failed.status).toBe(200);
    const [row] = await reminders(t);
    expect(row).toMatchObject({ status: "failed", attempts: 1 });
    expect(row!.lastError).toBe("connect ECONNREFUSED for [email]");

    const sent = await writeBack(t, { reminderKey, status: "sent" });
    expect(await sent.json()).toEqual({ ok: true, duplicate: false });
    const rows = await reminders(t);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ status: "sent", attempts: 2 });
    expect(rows[0]!.lastError).toBeUndefined();
  });

  test("failed twice counts both attempts", async () => {
    const { t, loan } = await circle();
    const reminderKey = `reminder:${await loan("2026-11-07")}:2026-11-10`;
    await writeBack(t, { reminderKey, status: "failed" });
    await writeBack(t, { reminderKey, status: "failed" });
    expect(await reminders(t)).toEqual([
      expect.objectContaining({ status: "failed", attempts: 2 }),
    ]);
  });

  test.each([
    ["not JSON", "nope"],
    ["missing the key", { status: "sent" }],
    ["an unknown status", { reminderKey: "KEY", status: "queued" }],
    ["a malformed key", { reminderKey: "notify:x:2026-11-10", status: "sent" }],
    ["a key for no Request", { reminderKey: "UNKNOWN", status: "sent" }],
  ])("answers 400 to a body with %s", async (_label, body) => {
    const { t, loan } = await circle();
    const loanId = await loan("2026-11-07");
    const fill = (b: unknown) =>
      typeof b === "string"
        ? b
        : JSON.parse(
            JSON.stringify(b)
              .replace("KEY", `reminder:${loanId}:2026-11-10`)
              .replace("UNKNOWN", "reminder:jd7abc:2026-11-10"),
          );
    const res = await writeBack(t, fill(body));
    expect(res.status).toBe(400);
    expect(await reminders(t)).toEqual([]);
  });

  test.each([
    ["unsigned", null],
    ["signed with the Convex → n8n secret", { secret: C2N }],
    ["stale", { now: Date.parse("2026-11-10T11:54:59Z") }],
  ])("rejects a write-back that is %s with 401", async (_label, opts) => {
    const { t, loan } = await circle();
    const body = JSON.stringify({
      reminderKey: `reminder:${await loan("2026-11-07")}:2026-11-10`,
      status: "sent",
    });
    const res = opts
      ? await writeBack(t, body, opts)
      : await t.fetch(REMINDERS, { method: "POST", body });
    expect(res.status).toBe(401);
    expect(await reminders(t)).toEqual([]);
  });

  test("rejects a tampered body with 401", async () => {
    const { t, loan } = await circle();
    const reminderKey = `reminder:${await loan("2026-11-07")}:2026-11-10`;
    const headers = await signedHeaders(N2C, {
      method: "POST",
      path: REMINDERS,
      body: JSON.stringify({ reminderKey, status: "failed" }),
    });
    const res = await t.fetch(REMINDERS, {
      method: "POST",
      headers,
      body: JSON.stringify({ reminderKey, status: "sent" }),
    });
    expect(res.status).toBe(401);
  });
});

describe("the activity line", () => {
  test("shows the latest Reminder to the Borrower and the Lender", async () => {
    const { t, loan, anna, ben } = await circle();
    const loanId = await loan("2026-11-07");
    await writeBack(t, {
      reminderKey: `reminder:${loanId}:2026-11-10`,
      status: "sent",
    });
    const expected = {
      label: "Reminder sent",
      at: expect.closeTo(Date.parse("2026-11-10T12:00:00Z"), -3),
      failed: false,
    };
    const mine = await ben.as.query(api.requests.listMine, {});
    expect(mine.find((r) => r._id === loanId)?.activity).toEqual(expected);
    const incoming = await anna.as.query(api.requests.listIncoming, {});
    expect(incoming.find((r) => r._id === loanId)?.activity).toEqual(expected);
  });

  test("a failed Reminder is flagged in the drawer history", async () => {
    const { t, loan, ben } = await circle();
    const loanId = await loan("2026-11-07");
    await writeBack(t, {
      reminderKey: `reminder:${loanId}:2026-11-10`,
      status: "failed",
    });
    const detail = await ben.as.query(api.requests.get, { requestId: loanId });
    expect(detail.history.at(-1)).toEqual({
      label: "Reminder failed",
      at: expect.closeTo(Date.parse("2026-11-10T12:00:00Z"), -3),
      failed: true,
    });
  });
});

describe("admin.runRemindersNow", () => {
  const WEBHOOK = "http://n8n:5678/webhook/reminders/run";
  type Call = { url: string; init: RequestInit };
  let calls: Call[];

  beforeEach(() => {
    vi.stubEnv("N8N_REMINDERS_WEBHOOK_URL", WEBHOOK);
    calls = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init: RequestInit) => {
        calls.push({ url: String(url), init });
        return new Response(null, { status: 202 });
      }),
    );
  });

  const auditRows = (t: TestConvex) =>
    t.run((ctx) => ctx.db.query("auditLog").collect());

  test("is forbidden for Members and signed-out callers", async () => {
    const { t, ben } = await circle();
    await expect(
      ben.as.mutation(api.admin.runRemindersNow, {}),
    ).rejects.toMatchObject({ data: { code: "FORBIDDEN" } });
    await expect(
      t.mutation(api.admin.runRemindersNow, {}),
    ).rejects.toMatchObject({ data: { code: "UNAUTHENTICATED" } });
    await t.finishAllScheduledFunctions(vi.runAllTimers);
    expect(calls).toEqual([]);
    expect(await auditRows(t)).toEqual([]);
  });

  test("audits the Admin and makes a signed call to the manual trigger", async () => {
    const { t } = await circle();
    const omar = await seedViewer(t, OMAR);
    await omar.as.mutation(api.admin.runRemindersNow, {});
    expect(await auditRows(t)).toEqual([
      expect.objectContaining({
        actorId: omar.userId,
        action: "reminders.run_now",
        target: omar.userId,
      }),
    ]);

    await t.finishAllScheduledFunctions(vi.runAllTimers);
    expect(calls).toHaveLength(1);
    const [call] = calls as [Call];
    expect(call.url).toBe(WEBHOOK);
    expect(call.init.method).toBe("POST");
    const headers = new Headers(call.init.headers);
    expect(
      await verifySignature({
        secret: C2N,
        method: "POST",
        path: "/webhook/reminders/run",
        body: String(call.init.body),
        timestamp: headers.get("x-lendloop-timestamp"),
        signature: headers.get("x-lendloop-signature"),
      }),
    ).toBe(true);
    expect(String(call.init.body)).not.toContain("@");
  });
});
