import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { api, internal } from "./_generated/api";
import { CATEGORIES } from "./lib/toolFields";
import { ANNA, newTest, seedViewer, type TestConvex } from "./testing.helpers";

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-11-10T12:00:00Z"));
});
afterEach(() => {
  vi.useRealTimers();
});

const all = (t: TestConvex) =>
  t.run(async (ctx) => ({
    users: await ctx.db.query("users").collect(),
    tools: await ctx.db.query("tools").collect(),
    requests: await ctx.db.query("requests").collect(),
    events: await ctx.db.query("automationEvents").collect(),
  }));

describe("seed.base", () => {
  test("creates 4 demo Members on @example.com, one of them a Trusted Lender", async () => {
    const t = newTest();
    await t.mutation(internal.seed.base, {});

    const { users } = await all(t);
    expect(users).toHaveLength(4);
    for (const user of users) {
      expect(user.email).toMatch(/@example\.com$/);
      expect(user.firstName).not.toBe("");
      expect(user.role).toBe("user");
      expect(user.demo).toBe(true);
    }
    expect(users.filter((u) => u.trustedLender)).toHaveLength(1);
  });

  test("creates 8 demo Tools covering every Category", async () => {
    const t = newTest();
    await t.mutation(internal.seed.base, {});

    const { tools } = await all(t);
    expect(tools).toHaveLength(8);
    expect(new Set(tools.map((tool) => tool.category))).toEqual(
      new Set(CATEGORIES),
    );
    expect(tools.every((tool) => tool.demo === true)).toBe(true);
  });
});

describe("seed.base Requests", () => {
  test("creates Requests in every state, exactly one of them an Overdue Loan", async () => {
    const t = newTest();
    await t.mutation(internal.seed.base, {});

    const { requests } = await all(t);
    expect(new Set(requests.map((r) => r.status))).toEqual(
      new Set(["pending", "approved", "returned", "declined", "cancelled"]),
    );
    const overdue = requests.filter(
      (r) => r.status === "approved" && r.endDate < "2026-11-10",
    );
    expect(overdue).toHaveLength(1);
    expect(requests.every((r) => r.demo === true)).toBe(true);
  });

  test("gives every Request an activity line a party can see, and sends no email", async () => {
    const t = newTest();
    await t.mutation(internal.seed.base, {});
    const tom = t.withIdentity({ issuer: "demo", subject: "tom" });

    const mine = await tom.query(api.requests.listMine, {});
    expect(mine.length).toBeGreaterThan(0);
    for (const row of mine) expect(row.activity).not.toBeNull();
    expect(mine.find((r) => r.overdue)?.activity?.label).toBe("Reminder sent");

    const { events } = await all(t);
    expect(events.every((e) => e.status === "sent" && e.demo)).toBe(true);
    const scheduled = await t.run((ctx) =>
      ctx.db.system.query("_scheduled_functions").collect(),
    );
    expect(scheduled).toHaveLength(0);
  });

  test("shows the Overdue Loan and a Trusted Lender on the board", async () => {
    const t = newTest();
    await t.mutation(internal.seed.base, {});
    const lena = t.withIdentity({ issuer: "demo", subject: "lena" });

    const board = await lena.query(api.tools.listBoard, {});
    expect(
      board.filter((tool) => tool.availability?.kind === "overdue"),
    ).toEqual([expect.objectContaining({ name: "Carpet cleaner" })]);
    expect(board.some((tool) => tool.lender.trusted)).toBe(true);
  });

  test("is skipped when any Tool already exists", async () => {
    const t = newTest();
    await t.mutation(internal.seed.base, {});
    expect(await t.mutation(internal.seed.base, {})).toEqual({ seeded: false });

    const { users, tools, requests } = await all(t);
    expect([users.length, tools.length, requests.length]).toEqual([4, 8, 6]);
  });
});

describe("seed.demo", () => {
  async function reviewerSignedIn() {
    const t = newTest();
    await t.mutation(internal.seed.base, {});
    const { userId, as } = await seedViewer(t, ANNA);
    return { t, userId, as };
  }

  test("fails clearly when that Member has never signed in", async () => {
    const t = newTest();
    await expect(
      t.mutation(internal.seed.demo, { email: "nobody@example.com" }),
    ).rejects.toMatchObject({
      data: {
        code: "NOT_FOUND",
        message: expect.stringMatching(/sign in .*once/i),
      },
    });
  });

  test("makes the reviewer an Admin", async () => {
    const { t, as } = await reviewerSignedIn();
    await t.mutation(internal.seed.demo, { email: " Anna@Example.com " });

    expect(await as.query(api.users.me, {})).toMatchObject({ role: "admin" });
  });

  test("lists a Tool of theirs with a pending incoming Request from a demo Member", async () => {
    const { t, as } = await reviewerSignedIn();
    await t.mutation(internal.seed.demo, { email: ANNA.email });

    const tools = await as.query(api.tools.listMine, {});
    expect(tools).toHaveLength(1);
    const incoming = await as.query(api.requests.listIncoming, {});
    expect(incoming).toEqual([
      expect.objectContaining({
        status: "pending",
        actions: ["approve", "decline"],
        tool: expect.objectContaining({ name: tools[0]!.name }),
      }),
    ]);
  });

  test("gives them an Overdue Loan as Borrower and a pending Request of their own", async () => {
    const { t, as } = await reviewerSignedIn();
    await t.mutation(internal.seed.demo, { email: ANNA.email });

    const mine = await as.query(api.requests.listMine, {});
    expect(mine).toHaveLength(2);
    expect(mine).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ status: "approved", overdue: true }),
        expect.objectContaining({ status: "pending", actions: ["cancel"] }),
      ]),
    );
  });

  test("puts the reviewer's Overdue Loan in the next reminder run", async () => {
    const { t } = await reviewerSignedIn();
    await t.mutation(internal.seed.demo, { email: ANNA.email });

    const { loans } = await t.mutation(internal.reminders.overdueLoans, {});
    expect(loans.map((loan) => loan.borrowerEmail)).toContain(ANNA.email);
  });

  test("is idempotent per email", async () => {
    const { t, as } = await reviewerSignedIn();
    await t.mutation(internal.seed.demo, { email: ANNA.email });
    const before = await all(t);
    await t.mutation(internal.seed.demo, { email: ANNA.email });

    const after = await all(t);
    expect(after.tools).toHaveLength(before.tools.length);
    expect(after.requests).toHaveLength(before.requests.length);
    expect(await as.query(api.requests.listMine, {})).toHaveLength(2);
  });

  test("reset wipes all LendLoop data, the reviewer's too, and re-runs the base seed", async () => {
    const { t, as } = await reviewerSignedIn();
    await t.mutation(internal.seed.demo, { email: ANNA.email });
    await as.mutation(api.tools.create, {
      name: "Anna's own saw",
      category: "hand_tools",
      condition: "good",
      description: "",
    });
    await t.mutation(internal.reminders.overdueLoans, {});

    expect(await t.mutation(internal.seed.reset, {})).toEqual({ seeded: true });

    const { users, tools, requests, events } = await all(t);
    expect([users.length, tools.length, requests.length]).toEqual([4, 8, 6]);
    expect(users.map((u) => u.email)).not.toContain(ANNA.email);
    expect(events.every((e) => e.demo)).toBe(true);
    expect(
      await t.run(async (ctx) => [
        ...(await ctx.db.query("auditLog").collect()),
        ...(await ctx.db.query("automationState").collect()),
      ]),
    ).toEqual([]);
  });

  test("works even when the base seed was skipped", async () => {
    const t = newTest();
    const { as } = await seedViewer(t, ANNA);
    await t.mutation(internal.seed.demo, { email: ANNA.email });

    expect(await as.query(api.requests.listIncoming, {})).toHaveLength(1);
    expect(await as.query(api.requests.listMine, {})).toHaveLength(2);
  });
});
