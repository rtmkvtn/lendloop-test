import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { api } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import * as adminModule from "./admin";
import {
  ANNA,
  BEN,
  CARA,
  OMAR,
  newTest,
  seedViewer,
  type TestConvex,
} from "./testing.helpers";

const drill = {
  name: "Cordless drill",
  category: "power_tools" as const,
  condition: "good" as const,
  description: "18V, two batteries.",
};

const rejectsWith = (code: string) => ({ data: { code } });
const REASON = "Battery recall: unsafe to lend";
// Under convex-test, Date.now() inside a function can be a millisecond past the faked time.
const NOW = expect.closeTo(Date.parse("2026-11-10T12:00:00Z"), -2);

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-11-10T12:00:00Z"));
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
});

async function board() {
  const t = newTest();
  const anna = await seedViewer(t, ANNA);
  const ben = await seedViewer(t, BEN);
  const cara = await seedViewer(t, CARA);
  const omar = await seedViewer(t, OMAR);
  const toolId = await anna.as.mutation(api.tools.create, drill);
  const request = (who: typeof ben, startDate: string, endDate: string) =>
    who.as.mutation(api.requests.create, { toolId, startDate, endDate });
  return { t, anna, ben, cara, omar, toolId, request };
}

const auditRows = (t: TestConvex) =>
  t.run((ctx) => ctx.db.query("auditLog").collect());
const events = (t: TestConvex) =>
  t.run((ctx) => ctx.db.query("automationEvents").collect());

describe("admin.removeTool", () => {
  test("soft-deletes the Tool with the Admin and the trimmed reason, and audits it", async () => {
    const { t, omar, toolId } = await board();
    await omar.as.mutation(api.admin.removeTool, {
      toolId,
      reason: `  ${REASON}  `,
    });

    const tool = await t.run((ctx) => ctx.db.get("tools", toolId));
    expect(tool).toMatchObject({
      removedAt: NOW,
      removedBy: omar.userId,
      removalReason: REASON,
    });
    expect(await auditRows(t)).toEqual([
      expect.objectContaining({
        actorId: omar.userId,
        action: "tool.removed",
        target: toolId,
      }),
    ]);
  });

  test.each([
    ["a blank reason", "   "],
    ["a reason over 500 characters", "x".repeat(501)],
  ])("rejects %s with INVALID and changes nothing", async (_label, reason) => {
    const { t, omar, toolId } = await board();
    await expect(
      omar.as.mutation(api.admin.removeTool, { toolId, reason }),
    ).rejects.toMatchObject(rejectsWith("INVALID"));
    const tool = await t.run((ctx) => ctx.db.get("tools", toolId));
    expect(tool?.removedAt).toBeUndefined();
    expect(await auditRows(t)).toEqual([]);
  });

  test("returns NOT_FOUND for a Tool that is already removed", async () => {
    const { omar, toolId } = await board();
    await omar.as.mutation(api.admin.removeTool, { toolId, reason: REASON });
    await expect(
      omar.as.mutation(api.admin.removeTool, { toolId, reason: REASON }),
    ).rejects.toMatchObject(rejectsWith("NOT_FOUND"));
  });

  test("auto-declines every pending Request and notifies each Borrower", async () => {
    const { t, ben, cara, omar, toolId, request } = await board();
    const benId = await request(ben, "2026-11-12", "2026-11-14");
    const caraId = await request(cara, "2026-11-13", "2026-11-15");

    await omar.as.mutation(api.admin.removeTool, { toolId, reason: REASON });

    for (const [requestId, borrower] of [
      [benId, ben],
      [caraId, cara],
    ] as const) {
      const row = await t.run((ctx) => ctx.db.get("requests", requestId));
      expect(row?.status).toBe("declined");
      const event = (await events(t)).find(
        (e) => e.idempotencyKey === `notify:${requestId}:request.auto_declined`,
      );
      expect(event).toMatchObject({ recipientId: borrower.userId });
      expect(await auditRows(t)).toContainEqual(
        expect.objectContaining({
          actorId: omar.userId,
          action: "request.auto_declined",
          target: requestId,
        }),
      );
    }
  });

  test("works with a live Loan, which stays approved and can still be returned", async () => {
    const { t, anna, ben, omar, toolId, request } = await board();
    const loanId = await request(ben, "2026-11-10", "2026-11-12");
    await anna.as.mutation(api.requests.approve, { requestId: loanId });

    await omar.as.mutation(api.admin.removeTool, { toolId, reason: REASON });

    const loan = await t.run((ctx) => ctx.db.get("requests", loanId));
    expect(loan?.status).toBe("approved");
    await anna.as.mutation(api.requests.markReturned, { requestId: loanId });
  });

  test("queues a tool.removed Notification for the Lender", async () => {
    const { t, anna, omar, toolId } = await board();
    await omar.as.mutation(api.admin.removeTool, { toolId, reason: REASON });
    expect(await events(t)).toEqual([
      expect.objectContaining({
        toolId,
        kind: "notification",
        event: "tool.removed",
        idempotencyKey: `notify:${toolId}:tool.removed`,
        recipientId: anna.userId,
        status: "pending",
        attempts: 0,
      }),
    ]);
  });

  test("tells the Lender why on My listings, and drops the Tool from the board", async () => {
    const { anna, ben, omar, toolId } = await board();
    await omar.as.mutation(api.admin.removeTool, { toolId, reason: REASON });
    const [mine] = await anna.as.query(api.tools.listMine, {});
    expect(mine?.removed).toEqual({
      at: NOW,
      reason: REASON,
    });
    expect(await ben.as.query(api.tools.listBoard, {})).toEqual([]);
  });
});

describe("removed Tool history", () => {
  test("keeps the Requests in both parties' history, with the Tool marked removed", async () => {
    const { anna, ben, cara, omar, toolId, request } = await board();
    const loanId = await request(ben, "2026-11-10", "2026-11-12");
    await anna.as.mutation(api.requests.approve, { requestId: loanId });
    await request(cara, "2026-11-20", "2026-11-21");

    await omar.as.mutation(api.admin.removeTool, { toolId, reason: REASON });

    const removedDrill = { name: "Cordless drill", removed: true };
    expect(await ben.as.query(api.requests.listMine, {})).toEqual([
      expect.objectContaining({ status: "approved", tool: removedDrill }),
    ]);
    expect(await cara.as.query(api.requests.listMine, {})).toEqual([
      expect.objectContaining({ status: "declined", tool: removedDrill }),
    ]);
    const incoming = await anna.as.query(api.requests.listIncoming, {});
    expect(incoming.map((r) => [r.status, r.tool])).toEqual([
      ["declined", removedDrill],
      ["approved", removedDrill],
    ]);
  });
});

describe("admin.listLoans", () => {
  async function withLoans() {
    const c = await board();
    const spareId = await c.anna.as.mutation(api.tools.create, {
      ...drill,
      name: "Ladder",
    });
    const liveId = await c.request(c.ben, "2026-11-10", "2026-11-12");
    await c.anna.as.mutation(api.requests.approve, { requestId: liveId });
    const returnedId = await c.cara.as.mutation(api.requests.create, {
      toolId: spareId,
      startDate: "2026-11-10",
      endDate: "2026-11-11",
    });
    await c.anna.as.mutation(api.requests.approve, { requestId: returnedId });
    await c.anna.as.mutation(api.requests.markReturned, {
      requestId: returnedId,
    });
    await c.request(c.cara, "2026-11-20", "2026-11-21");
    return { ...c, liveId, returnedId };
  }

  test("lists approved and returned Requests with both parties, newest first", async () => {
    const { omar, liveId, returnedId } = await withLoans();
    const loans = await omar.as.query(api.admin.listLoans, {});
    expect(loans).toEqual([
      expect.objectContaining({
        _id: returnedId,
        status: "returned",
        tool: { name: "Ladder", removed: false },
        lender: { name: "Anna Lee", trusted: false },
        borrower: { name: "Cara Novak" },
        startDate: "2026-11-10",
        endDate: "2026-11-11",
        actions: [],
      }),
      expect.objectContaining({
        _id: liveId,
        status: "approved",
        tool: { name: "Cordless drill", removed: false },
        borrower: { name: "Ben Ortiz" },
        activity: expect.objectContaining({
          label: "Approval email to borrower queued",
        }),
      }),
    ]);
  });

  test.each([
    ["approved", "liveId"],
    ["returned", "returnedId"],
  ] as const)("filters by status %s", async (status, key) => {
    const c = await withLoans();
    const loans = await c.omar.as.query(api.admin.listLoans, { status });
    expect(loans.map((l) => l._id)).toEqual([c[key]]);
  });

  test("rejects a status that is not a Loan status", async () => {
    const { omar } = await withLoans();
    await expect(
      omar.as.query(api.admin.listLoans, { status: "pending" } as never),
    ).rejects.toThrow();
  });
});

describe("admin.setTrustedLender", () => {
  test("grants and revokes, audits both, and the board's Trusted badge follows", async () => {
    const { t, anna, ben, omar } = await board();
    const badge = async () =>
      (await ben.as.query(api.tools.listBoard, {}))[0]?.lender.trusted;

    await omar.as.mutation(api.admin.setTrustedLender, {
      userId: anna.userId,
      trusted: true,
    });
    expect(await badge()).toBe(true);
    await omar.as.mutation(api.admin.setTrustedLender, {
      userId: anna.userId,
      trusted: false,
    });
    expect(await badge()).toBe(false);

    expect(
      (await auditRows(t)).map((r) => [r.actorId, r.action, r.target]),
    ).toEqual([
      [omar.userId, "user.trusted_lender_granted", anna.userId],
      [omar.userId, "user.trusted_lender_revoked", anna.userId],
    ]);
  });
});

describe("admin.listLenders", () => {
  test("lists every Member with their Trusted flag and listing count", async () => {
    const { anna, omar } = await board();
    await anna.as.mutation(api.tools.create, { ...drill, name: "Ladder" });
    const lenders = await omar.as.query(api.admin.listLenders, {});
    expect(lenders).toEqual([
      { _id: anna.userId, name: "Anna Lee", trusted: false, listings: 2 },
      expect.objectContaining({ name: "Ben Ortiz", listings: 0 }),
      expect.objectContaining({ name: "Cara Novak", listings: 0 }),
      expect.objectContaining({ name: "Omar Haddad", listings: 0 }),
    ]);
    expect(JSON.stringify(lenders)).not.toContain("@");
  });
});

describe("admin.listListings", () => {
  test("lists every Tool, including removed ones with their reason", async () => {
    const { anna, omar, toolId } = await board();
    const ladderId = await anna.as.mutation(api.tools.create, {
      ...drill,
      name: "Ladder",
    });
    await omar.as.mutation(api.admin.removeTool, { toolId, reason: REASON });
    expect(await omar.as.query(api.admin.listListings, {})).toEqual([
      expect.objectContaining({
        _id: ladderId,
        name: "Ladder",
        lender: { name: "Anna Lee", trusted: false },
        availability: { kind: "available" },
        removed: null,
      }),
      expect.objectContaining({
        _id: toolId,
        name: "Cordless drill",
        availability: null,
        removed: {
          at: NOW,
          reason: REASON,
        },
      }),
    ]);
  });
});

describe("RBAC", () => {
  type Caller = Awaited<ReturnType<typeof seedViewer>>["as"] | TestConvex;
  type Call = (
    as: Caller,
    c: Awaited<ReturnType<typeof board>>,
  ) => Promise<unknown>;

  const calls: Record<string, Call> = {
    removeTool: (as, c) =>
      as.mutation(api.admin.removeTool, { toolId: c.toolId, reason: REASON }),
    listLoans: (as) => as.query(api.admin.listLoans, {}),
    setTrustedLender: (as, c) =>
      as.mutation(api.admin.setTrustedLender, {
        userId: c.anna.userId,
        trusted: true,
      }),
    listLenders: (as) => as.query(api.admin.listLenders, {}),
    listListings: (as) => as.query(api.admin.listListings, {}),
    runRemindersNow: (as) => as.mutation(api.admin.runRemindersNow, {}),
    retryEvent: async (as, c) => {
      const eventId = await c.t.run((ctx) =>
        ctx.db.insert("automationEvents", {
          toolId: c.toolId,
          kind: "notification",
          event: "tool.removed",
          idempotencyKey: `notify:${c.toolId}:tool.removed`,
          recipientId: c.anna.userId,
          status: "failed",
          attempts: 5,
          updatedAt: Date.now(),
        }),
      );
      return await as.mutation(api.admin.retryEvent, { eventId });
    },
    automationHealth: (as) => as.query(api.admin.automationHealth, {}),
  };

  test("covers every public Admin function", () => {
    expect(Object.keys(calls).sort()).toEqual(Object.keys(adminModule).sort());
  });

  const matrix = Object.keys(calls).flatMap((fn) =>
    (
      [
        ["signed out", "UNAUTHENTICATED"],
        ["the Lender", "FORBIDDEN"],
        ["another Member", "FORBIDDEN"],
        ["an Admin", "ok"],
      ] as const
    ).map(([viewer, result]) => [fn, viewer, result] as const),
  );

  test.each(matrix)("admin.%s as %s → %s", async (fn, viewer, result) => {
    const c = await board();
    const as = {
      "signed out": c.t,
      "the Lender": c.anna.as,
      "another Member": c.ben.as,
      "an Admin": c.omar.as,
    }[viewer];
    const call = calls[fn]!(as, c);
    if (result === "ok") {
      await call;
    } else {
      await expect(call).rejects.toMatchObject(rejectsWith(result));
      expect(await auditRows(c.t)).toEqual([]);
    }
  });

  test("an Admin gets NOT_FOUND from Member functions on someone else's Tool or Request", async () => {
    const { anna, ben, omar, toolId, request } = await board();
    const requestId = await request(ben, "2026-11-12", "2026-11-14");
    const own = (requestId: Id<"requests">) => ({ requestId });
    for (const call of [
      omar.as.mutation(api.tools.update, { toolId, ...drill, name: "Mine" }),
      omar.as.mutation(api.tools.remove, { toolId }),
      omar.as.mutation(api.requests.approve, own(requestId)),
      omar.as.mutation(api.requests.decline, own(requestId)),
      omar.as.mutation(api.requests.cancel, own(requestId)),
      omar.as.mutation(api.requests.markReturned, own(requestId)),
    ]) {
      await expect(call).rejects.toMatchObject(rejectsWith("NOT_FOUND"));
    }
    expect(await anna.as.query(api.tools.listMine, {})).toHaveLength(1);
  });
});
