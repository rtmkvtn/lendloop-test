import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { api } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import * as requestsModule from "./requests";
import { ANNA, BEN, CARA, OMAR, newTest, seedViewer } from "./testing.helpers";

const drill = {
  name: "Cordless drill",
  category: "power_tools" as const,
  condition: "good" as const,
  description: "18V, two batteries.",
};

const rejectsWith = (code: string) => ({ data: { code } });
// Under convex-test, Date.now() inside a function can be a millisecond past the faked time.
const around = (iso: string) => expect.closeTo(Date.parse(iso), -2);

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-11-10T12:00:00Z"));
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
});

async function lendingCircle() {
  const t = newTest();
  const anna = await seedViewer(t, ANNA);
  const ben = await seedViewer(t, BEN);
  const cara = await seedViewer(t, CARA);
  const omar = await seedViewer(t, OMAR);
  const toolId = await anna.as.mutation(api.tools.create, drill);
  const readRequest = (id: Id<"requests">) =>
    t.run((ctx) => ctx.db.get("requests", id));
  const auditFor = (target: string) =>
    t.run(async (ctx) =>
      (await ctx.db.query("auditLog").collect()).filter(
        (row) => row.target === target,
      ),
    );
  return { t, anna, ben, cara, omar, toolId, readRequest, auditFor };
}

describe("requests.create", () => {
  test("stores a pending Request with the Lender copied from the Tool", async () => {
    const { anna, ben, toolId, readRequest } = await lendingCircle();
    const id = await ben.as.mutation(api.requests.create, {
      toolId,
      startDate: "2026-11-12",
      endDate: "2026-11-14",
    });
    expect(await readRequest(id)).toMatchObject({
      toolId,
      borrowerId: ben.userId,
      lenderId: anna.userId,
      startDate: "2026-11-12",
      endDate: "2026-11-14",
      status: "pending",
    });
  });

  test("rejects a Request for the caller's own Tool with INVALID", async () => {
    const { anna, toolId } = await lendingCircle();
    await expect(
      anna.as.mutation(api.requests.create, {
        toolId,
        startDate: "2026-11-12",
        endDate: "2026-11-12",
      }),
    ).rejects.toMatchObject(rejectsWith("INVALID"));
  });

  test.each([
    ["a start before today", "2026-11-09", "2026-11-12"],
    ["an end before the start", "2026-11-14", "2026-11-13"],
    ["a range of 31 days", "2026-11-10", "2026-12-10"],
    ["a malformed date", "2026-11-1", "2026-11-12"],
    ["an impossible date", "2026-11-12", "2026-11-31"],
  ])("rejects %s with INVALID", async (_label, startDate, endDate) => {
    const { ben, toolId } = await lendingCircle();
    await expect(
      ben.as.mutation(api.requests.create, { toolId, startDate, endDate }),
    ).rejects.toMatchObject(rejectsWith("INVALID"));
  });

  test("accepts today as the start and a range of exactly 30 days", async () => {
    const { ben, toolId } = await lendingCircle();
    await ben.as.mutation(api.requests.create, {
      toolId,
      startDate: "2026-11-10",
      endDate: "2026-12-09",
    });
  });

  test("works out today in APP_TIMEZONE", async () => {
    const { ben, toolId } = await lendingCircle();
    vi.setSystemTime(new Date("2026-11-10T23:30:00Z"));
    vi.stubEnv("APP_TIMEZONE", "Pacific/Kiritimati");
    await expect(
      ben.as.mutation(api.requests.create, {
        toolId,
        startDate: "2026-11-10",
        endDate: "2026-11-12",
      }),
    ).rejects.toMatchObject(rejectsWith("INVALID"));
    await ben.as.mutation(api.requests.create, {
      toolId,
      startDate: "2026-11-11",
      endDate: "2026-11-12",
    });
  });

  test("rejects overlap with an existing Loan with CONFLICT", async () => {
    const { anna, ben, cara, toolId } = await lendingCircle();
    const loan = await ben.as.mutation(api.requests.create, {
      toolId,
      startDate: "2026-11-12",
      endDate: "2026-11-14",
    });
    await anna.as.mutation(api.requests.approve, { requestId: loan });
    await expect(
      cara.as.mutation(api.requests.create, {
        toolId,
        startDate: "2026-11-14",
        endDate: "2026-11-20",
      }),
    ).rejects.toMatchObject({
      data: {
        code: "CONFLICT",
        message: "Those dates overlap an existing loan",
      },
    });
    await cara.as.mutation(api.requests.create, {
      toolId,
      startDate: "2026-11-15",
      endDate: "2026-11-20",
    });
  });

  test("allows dates that overlap another pending Request", async () => {
    const { ben, cara, toolId } = await lendingCircle();
    const dates = { toolId, startDate: "2026-11-12", endDate: "2026-11-14" };
    await ben.as.mutation(api.requests.create, dates);
    await cara.as.mutation(api.requests.create, dates);
  });

  test("rejects a second pending Request by the same Borrower for the same Tool", async () => {
    const { ben, toolId } = await lendingCircle();
    await ben.as.mutation(api.requests.create, {
      toolId,
      startDate: "2026-11-12",
      endDate: "2026-11-14",
    });
    await expect(
      ben.as.mutation(api.requests.create, {
        toolId,
        startDate: "2026-11-20",
        endDate: "2026-11-21",
      }),
    ).rejects.toMatchObject(rejectsWith("CONFLICT"));
  });

  test("allows a new Request once the earlier one is no longer pending", async () => {
    const { ben, toolId } = await lendingCircle();
    const first = await ben.as.mutation(api.requests.create, {
      toolId,
      startDate: "2026-11-12",
      endDate: "2026-11-14",
    });
    await ben.as.mutation(api.requests.cancel, { requestId: first });
    await ben.as.mutation(api.requests.create, {
      toolId,
      startDate: "2026-11-12",
      endDate: "2026-11-14",
    });
  });

  test("rejects a removed Tool with NOT_FOUND", async () => {
    const { anna, ben, toolId } = await lendingCircle();
    await anna.as.mutation(api.tools.remove, { toolId });
    await expect(
      ben.as.mutation(api.requests.create, {
        toolId,
        startDate: "2026-11-12",
        endDate: "2026-11-14",
      }),
    ).rejects.toMatchObject(rejectsWith("NOT_FOUND"));
  });
});

async function withPendingRequest(
  dates = { startDate: "2026-11-12", endDate: "2026-11-14" },
) {
  const circle = await lendingCircle();
  const requestId = await circle.ben.as.mutation(api.requests.create, {
    toolId: circle.toolId,
    ...dates,
  });
  return { ...circle, requestId };
}

type Circle = Awaited<ReturnType<typeof withPendingRequest>>;
type Transition = "approve" | "decline" | "markReturned" | "cancel";

const STATE_OF: Record<Transition, string> = {
  approve: "approved",
  decline: "declined",
  markReturned: "returned",
  cancel: "cancelled",
};

function run(c: Circle, step: Transition) {
  const as = step === "cancel" ? c.ben.as : c.anna.as;
  return as.mutation(api.requests[step], { requestId: c.requestId });
}

describe("the transition table", () => {
  const paths: Record<string, Transition[]> = {
    pending: [],
    approved: ["approve"],
    declined: ["decline"],
    cancelled: ["cancel"],
    returned: ["approve", "markReturned"],
  };
  const legal: Record<string, Transition[]> = {
    pending: ["approve", "decline", "cancel"],
    approved: ["markReturned"],
    declined: [],
    cancelled: [],
    returned: [],
  };
  const cases = Object.entries(paths).flatMap(([from, path]) =>
    (["approve", "decline", "markReturned", "cancel"] as const).map(
      (step) => [from, step, legal[from]!.includes(step), path] as const,
    ),
  );

  test.each(cases)(
    "from %s, %s is legal: %s",
    async (from, step, isLegal, path) => {
      const c = await withPendingRequest();
      for (const earlier of path) await run(c, earlier);
      expect((await c.readRequest(c.requestId))?.status).toBe(from);

      if (isLegal) {
        await run(c, step);
        expect((await c.readRequest(c.requestId))?.status).toBe(STATE_OF[step]);
      } else {
        await expect(run(c, step)).rejects.toMatchObject(
          rejectsWith("CONFLICT"),
        );
        expect((await c.readRequest(c.requestId))?.status).toBe(from);
      }
    },
  );

  test("records each status change in the audit log with its actor and timestamp", async () => {
    const c = await withPendingRequest();
    await run(c, "approve");
    vi.setSystemTime(new Date("2026-11-13T09:00:00Z"));
    await run(c, "markReturned");

    const rows = await c.auditFor(c.requestId);
    expect(
      rows.map(({ actorId, action, target, at }) => ({
        actorId,
        action,
        target,
        at,
      })),
    ).toEqual([
      {
        actorId: c.anna.userId,
        action: "request.approved",
        target: c.requestId,
        at: around("2026-11-10T12:00:00Z"),
      },
      {
        actorId: c.anna.userId,
        action: "request.returned",
        target: c.requestId,
        at: around("2026-11-13T09:00:00Z"),
      },
    ]);
    expect(await c.readRequest(c.requestId)).toMatchObject({
      decidedAt: around("2026-11-10T12:00:00Z"),
      returnedAt: around("2026-11-13T09:00:00Z"),
    });
  });

  test("writes no audit row when a transition is rejected", async () => {
    const c = await withPendingRequest();
    await run(c, "decline");
    await expect(run(c, "approve")).rejects.toThrow();
    expect((await c.auditFor(c.requestId)).map((r) => r.action)).toEqual([
      "request.declined",
    ]);
  });

  test("stamps cancelledAt on cancel, with the Borrower as actor", async () => {
    const c = await withPendingRequest();
    await run(c, "cancel");
    expect((await c.readRequest(c.requestId))?.cancelledAt).toEqual(
      around("2026-11-10T12:00:00Z"),
    );
    expect(await c.auditFor(c.requestId)).toMatchObject([
      { actorId: c.ben.userId, action: "request.cancelled" },
    ]);
  });
});

describe("requests.approve", () => {
  test("gives the second of two overlapping approvals CONFLICT", async () => {
    const c = await withPendingRequest();
    const caras = await c.cara.as.mutation(api.requests.create, {
      toolId: c.toolId,
      startDate: "2026-11-13",
      endDate: "2026-11-16",
    });
    await c.anna.as.mutation(api.requests.approve, {
      requestId: c.requestId,
    });
    await expect(
      c.anna.as.mutation(api.requests.approve, { requestId: caras }),
    ).rejects.toMatchObject({
      data: {
        code: "CONFLICT",
        message: "Those dates overlap an existing loan",
      },
    });
    expect((await c.readRequest(caras))?.status).toBe("pending");
    await c.anna.as.mutation(api.requests.decline, { requestId: caras });
  });

  test("allows approval after the start date while the end date hasn't passed", async () => {
    const c = await withPendingRequest();
    vi.setSystemTime(new Date("2026-11-14T20:00:00Z"));
    await run(c, "approve");
    expect((await c.readRequest(c.requestId))?.status).toBe("approved");
  });

  test("refuses approval once the end date has passed, but still allows decline", async () => {
    const c = await withPendingRequest();
    vi.setSystemTime(new Date("2026-11-15T00:30:00Z"));
    await expect(run(c, "approve")).rejects.toMatchObject(
      rejectsWith("CONFLICT"),
    );
    await run(c, "decline");
  });

  test("judges the end date in APP_TIMEZONE", async () => {
    const c = await withPendingRequest();
    vi.setSystemTime(new Date("2026-11-15T03:00:00Z"));
    vi.stubEnv("APP_TIMEZONE", "America/Los_Angeles");
    await run(c, "approve");
  });
});

describe("tools.remove with Requests", () => {
  test("returns CONFLICT while an unreturned Loan exists, and works once it is returned", async () => {
    const c = await withPendingRequest();
    await run(c, "approve");
    await expect(
      c.anna.as.mutation(api.tools.remove, { toolId: c.toolId }),
    ).rejects.toMatchObject({
      data: { code: "CONFLICT", message: "Mark the loan returned first" },
    });
    await run(c, "markReturned");
    await c.anna.as.mutation(api.tools.remove, { toolId: c.toolId });
  });

  test("auto-declines every pending Request on the deleted Tool and audits it", async () => {
    const c = await withPendingRequest();
    const caras = await c.cara.as.mutation(api.requests.create, {
      toolId: c.toolId,
      startDate: "2026-11-20",
      endDate: "2026-11-21",
    });
    await c.anna.as.mutation(api.tools.remove, { toolId: c.toolId });

    for (const id of [c.requestId, caras]) {
      expect(await c.readRequest(id)).toMatchObject({
        status: "declined",
        decidedAt: expect.any(Number),
      });
      expect(await c.auditFor(id)).toMatchObject([
        { actorId: c.anna.userId, action: "request.auto_declined" },
      ]);
    }
  });
});

describe("RBAC matrix", () => {
  type Viewer = "signed out" | "other Member" | "Borrower" | "Lender" | "Admin";
  type Caller = Circle["ben"]["as"] | Circle["t"];
  type Call = (
    as: Caller,
    c: Circle & { spareToolId: Id<"tools"> },
  ) => Promise<unknown>;
  type RequestFunction = keyof typeof requestsModule;

  const byId = (c: Circle) => ({ requestId: c.requestId });
  const calls: Record<RequestFunction, Call> = {
    create: (as, c) =>
      as.mutation(api.requests.create, {
        toolId: c.spareToolId,
        startDate: "2026-11-12",
        endDate: "2026-11-14",
      }),
    cancel: (as, c) => as.mutation(api.requests.cancel, byId(c)),
    approve: (as, c) => as.mutation(api.requests.approve, byId(c)),
    decline: (as, c) => as.mutation(api.requests.decline, byId(c)),
    markReturned: async (as, c) => {
      await c.anna.as.mutation(api.requests.approve, byId(c));
      return await as.mutation(api.requests.markReturned, byId(c));
    },
    listMine: (as) => as.query(api.requests.listMine, {}),
    listIncoming: (as) => as.query(api.requests.listIncoming, {}),
    countPendingIncoming: (as) =>
      as.query(api.requests.countPendingIncoming, {}),
    get: (as, c) => as.query(api.requests.get, byId(c)),
  };

  const OK = "ok";
  const U = "UNAUTHENTICATED";
  const lenderOnly = [U, "NOT_FOUND", "FORBIDDEN", OK, "NOT_FOUND"];
  const expected: Record<RequestFunction, string[]> = {
    // columns: signed out, other Member, Borrower, Lender, Admin
    create: [U, OK, OK, "INVALID", OK],
    cancel: [U, "NOT_FOUND", OK, "FORBIDDEN", "NOT_FOUND"],
    approve: lenderOnly,
    decline: lenderOnly,
    markReturned: lenderOnly,
    listMine: [U, OK, OK, OK, OK],
    listIncoming: [U, OK, OK, OK, OK],
    countPendingIncoming: [U, OK, OK, OK, OK],
    get: [U, "NOT_FOUND", OK, OK, OK],
  };
  const VIEWERS: Viewer[] = [
    "signed out",
    "other Member",
    "Borrower",
    "Lender",
    "Admin",
  ];
  const matrix = (Object.keys(expected) as RequestFunction[]).flatMap((fn) =>
    VIEWERS.map((viewer, i) => [fn, viewer, expected[fn][i]!] as const),
  );

  test("covers every public Request function", () => {
    const exported = Object.keys(requestsModule).sort();
    expect(Object.keys(calls).sort()).toEqual(exported);
    expect(Object.keys(expected).sort()).toEqual(exported);
  });

  test.each(matrix)("requests.%s as %s → %s", async (fn, viewer, result) => {
    const c = await withPendingRequest();
    const spareToolId = await c.anna.as.mutation(api.tools.create, {
      ...drill,
      name: "Spare drill",
    });
    const as: Record<Viewer, Caller> = {
      "signed out": c.t,
      "other Member": c.cara.as,
      Borrower: c.ben.as,
      Lender: c.anna.as,
      Admin: c.omar.as,
    };
    const call = calls[fn](as[viewer], { ...c, spareToolId });
    if (result === OK) {
      await call;
    } else {
      await expect(call).rejects.toMatchObject(rejectsWith(result));
    }
  });
});

describe("request views", () => {
  test("My requests lists the caller's Requests with Lender, Trusted badge and allowed actions", async () => {
    const c = await withPendingRequest();
    await c.t.run((ctx) =>
      ctx.db.patch("users", c.anna.userId, { trustedLender: true }),
    );
    const rows = await c.ben.as.query(api.requests.listMine, {});
    expect(rows).toEqual([
      {
        _id: c.requestId,
        _creationTime: expect.any(Number),
        status: "pending",
        startDate: "2026-11-12",
        endDate: "2026-11-14",
        overdue: false,
        tool: { name: drill.name, removed: false },
        lender: { name: ANNA.name, trusted: true },
        borrower: { name: BEN.name },
        actions: ["cancel"],
        activity: {
          label: "Request email to lender queued",
          at: expect.any(Number),
          failed: false,
        },
      },
    ]);
    expect(await c.cara.as.query(api.requests.listMine, {})).toEqual([]);
  });

  test("Incoming lists Requests for the caller's Tools with only the actions each status allows", async () => {
    const c = await withPendingRequest();
    const caras = await c.cara.as.mutation(api.requests.create, {
      toolId: c.toolId,
      startDate: "2026-11-20",
      endDate: "2026-11-21",
    });
    await c.anna.as.mutation(api.requests.approve, { requestId: caras });

    const rows = await c.anna.as.query(api.requests.listIncoming, {});
    expect(rows.map((r) => [r.borrower.name, r.status, r.actions])).toEqual([
      [CARA.name, "approved", ["markReturned"]],
      [BEN.name, "pending", ["approve", "decline"]],
    ]);
    expect(await c.ben.as.query(api.requests.listIncoming, {})).toEqual([]);
  });

  test("flags an unreturned Loan past its end date as overdue, not one ending today", async () => {
    const c = await withPendingRequest();
    await c.anna.as.mutation(api.requests.approve, { requestId: c.requestId });
    vi.setSystemTime(new Date("2026-11-14T22:00:00Z"));
    expect((await c.ben.as.query(api.requests.listMine, {}))[0]?.overdue).toBe(
      false,
    );
    vi.setSystemTime(new Date("2026-11-15T01:00:00Z"));
    expect((await c.ben.as.query(api.requests.listMine, {}))[0]?.overdue).toBe(
      true,
    );
    await c.anna.as.mutation(api.requests.markReturned, {
      requestId: c.requestId,
    });
    expect((await c.ben.as.query(api.requests.listMine, {}))[0]?.overdue).toBe(
      false,
    );
  });

  test("offers only Decline on a pending Request whose end date has passed", async () => {
    const c = await withPendingRequest();
    vi.setSystemTime(new Date("2026-11-16T10:00:00Z"));
    const [row] = await c.anna.as.query(api.requests.listIncoming, {});
    expect(row?.actions).toEqual(["decline"]);
  });

  test("counts only pending incoming Requests for the sidebar", async () => {
    const c = await withPendingRequest();
    const caras = await c.cara.as.mutation(api.requests.create, {
      toolId: c.toolId,
      startDate: "2026-11-20",
      endDate: "2026-11-21",
    });
    expect(await c.anna.as.query(api.requests.countPendingIncoming, {})).toBe(
      2,
    );
    await c.anna.as.mutation(api.requests.decline, { requestId: caras });
    expect(await c.anna.as.query(api.requests.countPendingIncoming, {})).toBe(
      1,
    );
    expect(await c.ben.as.query(api.requests.countPendingIncoming, {})).toBe(0);
  });

  test("keeps a removed Tool's Requests in both parties' history, marked removed", async () => {
    const c = await withPendingRequest();
    await c.anna.as.mutation(api.tools.remove, { toolId: c.toolId });
    const [mine] = await c.ben.as.query(api.requests.listMine, {});
    const [incoming] = await c.anna.as.query(api.requests.listIncoming, {});
    for (const row of [mine, incoming]) {
      expect(row).toMatchObject({
        status: "declined",
        tool: { name: drill.name, removed: true },
        actions: [],
      });
    }
  });

  test("never contains an email address", async () => {
    const c = await withPendingRequest();
    const views = [
      await c.ben.as.query(api.requests.listMine, {}),
      await c.anna.as.query(api.requests.listIncoming, {}),
      await c.omar.as.query(api.requests.get, { requestId: c.requestId }),
    ];
    expect(JSON.stringify(views)).not.toContain("@");
  });

  test("requests.get returns the Request with its status history and the viewer's role", async () => {
    const c = await withPendingRequest();
    await c.anna.as.mutation(api.requests.approve, { requestId: c.requestId });

    const forLender = await c.anna.as.query(api.requests.get, {
      requestId: c.requestId,
    });
    expect(forLender).toMatchObject({
      _id: c.requestId,
      status: "approved",
      viewerRole: "lender",
      actions: ["markReturned"],
      history: [
        { label: "Requested", at: expect.any(Number), failed: false },
        { label: "Request email to lender queued", at: expect.any(Number) },
        { label: "Approved", at: expect.any(Number), failed: false },
        { label: "Approval email to borrower queued", at: expect.any(Number) },
      ],
    });
    expect(
      await c.ben.as.query(api.requests.get, { requestId: c.requestId }),
    ).toMatchObject({ viewerRole: "borrower", actions: [] });
    expect(
      await c.omar.as.query(api.requests.get, { requestId: c.requestId }),
    ).toMatchObject({ viewerRole: "admin", actions: [] });
  });
});

describe("availability on the board", () => {
  async function loanFor(
    c: Awaited<ReturnType<typeof lendingCircle>>,
    who: "ben" | "cara",
    startDate: string,
    endDate: string,
  ) {
    const requestId = await c[who].as.mutation(api.requests.create, {
      toolId: c.toolId,
      startDate,
      endDate,
    });
    await c.anna.as.mutation(api.requests.approve, { requestId });
    return requestId;
  }

  async function availability(c: Awaited<ReturnType<typeof lendingCircle>>) {
    const [row] = await c.ben.as.query(api.tools.listBoard, {});
    const [mine] = await c.anna.as.query(api.tools.listMine, {});
    expect(mine?.availability).toEqual(row?.availability);
    return row?.availability;
  }

  const onPublicList = async (c: Awaited<ReturnType<typeof lendingCircle>>) =>
    (await c.t.query(api.tools.listPublic, {})).length === 1;

  test("stays Available with only pending Requests", async () => {
    const c = await lendingCircle();
    await c.ben.as.mutation(api.requests.create, {
      toolId: c.toolId,
      startDate: "2026-11-10",
      endDate: "2026-11-12",
    });
    expect(await availability(c)).toEqual({ kind: "available" });
    expect(await onPublicList(c)).toBe(true);
  });

  test("shows the earliest future Loan as 'booked from' and stays on the public list", async () => {
    const c = await lendingCircle();
    await loanFor(c, "ben", "2026-11-20", "2026-11-22");
    await loanFor(c, "cara", "2026-11-12", "2026-11-14");
    expect(await availability(c)).toEqual({
      kind: "available",
      bookedFrom: "2026-11-12",
    });
    expect(await onPublicList(c)).toBe(true);
  });

  test("shows a Loan covering today as 'on loan until' and leaves the public list", async () => {
    const c = await lendingCircle();
    await loanFor(c, "ben", "2026-11-10", "2026-11-12");
    expect(await availability(c)).toEqual({
      kind: "on_loan",
      until: "2026-11-12",
    });
    expect(await onPublicList(c)).toBe(false);
  });

  test("does not call a Loan whose end date is today Overdue", async () => {
    const c = await lendingCircle();
    await loanFor(c, "ben", "2026-11-10", "2026-11-12");
    vi.setSystemTime(new Date("2026-11-12T23:59:00Z"));
    expect(await availability(c)).toEqual({
      kind: "on_loan",
      until: "2026-11-12",
    });
  });

  test("calls an unreturned Loan Overdue from the day after its end date", async () => {
    const c = await lendingCircle();
    await loanFor(c, "ben", "2026-11-10", "2026-11-12");
    await c.cara.as.mutation(api.requests.create, {
      toolId: c.toolId,
      startDate: "2026-11-20",
      endDate: "2026-11-21",
    });
    vi.setSystemTime(new Date("2026-11-15T08:00:00Z"));
    expect(await availability(c)).toEqual({
      kind: "overdue",
      since: "2026-11-13",
    });
    expect(await onPublicList(c)).toBe(false);
  });

  test("works out Overdue in APP_TIMEZONE", async () => {
    const c = await lendingCircle();
    await loanFor(c, "ben", "2026-11-10", "2026-11-12");
    vi.setSystemTime(new Date("2026-11-12T23:30:00Z"));
    expect(await availability(c)).toMatchObject({ kind: "on_loan" });
    vi.stubEnv("APP_TIMEZONE", "Pacific/Kiritimati");
    expect(await availability(c)).toMatchObject({ kind: "overdue" });
  });

  test("is Available again once the Loan is marked returned early", async () => {
    const c = await lendingCircle();
    const loan = await loanFor(c, "ben", "2026-11-10", "2026-11-20");
    await c.anna.as.mutation(api.requests.markReturned, { requestId: loan });
    expect(await availability(c)).toEqual({ kind: "available" });
    expect(await onPublicList(c)).toBe(true);
  });
});
