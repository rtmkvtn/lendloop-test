import { describe, expect, test } from "vitest";
import { api } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import * as toolsModule from "./tools";
import { ANNA, BEN, OMAR, newTest, seedViewer } from "./testing.helpers";

const drill = {
  name: "Cordless drill",
  category: "power_tools" as const,
  condition: "good" as const,
  description: "18V, two batteries.",
};

const rejectsWith = (code: string) => ({ data: { code } });

describe("tools.create", () => {
  test("stores a Tool owned by the caller, with name and description trimmed", async () => {
    const t = newTest();
    const anna = await seedViewer(t, ANNA);

    const toolId = await anna.as.mutation(api.tools.create, {
      ...drill,
      name: "  Cordless drill  ",
      description: "  18V, two batteries.  ",
    });

    const row = await t.run((ctx) => ctx.db.get("tools", toolId));
    expect(row).toMatchObject({ ...drill, ownerId: anna.userId });
    expect(row?.removedAt).toBeUndefined();
  });

  test.each([
    ["a blank name", { name: "   " }],
    ["a name over 80 characters", { name: "x".repeat(81) }],
    ["a description over 500 characters", { description: "x".repeat(501) }],
  ])("rejects %s with INVALID", async (_label, override) => {
    const t = newTest();
    const anna = await seedViewer(t, ANNA);
    await expect(
      anna.as.mutation(api.tools.create, { ...drill, ...override }),
    ).rejects.toMatchObject(rejectsWith("INVALID"));
  });

  test("accepts a name of exactly 80 characters once trimmed", async () => {
    const t = newTest();
    const anna = await seedViewer(t, ANNA);
    const name = "x".repeat(80);
    const toolId = await anna.as.mutation(api.tools.create, {
      ...drill,
      name: `  ${name}  `,
      description: "",
    });
    const row = await t.run((ctx) => ctx.db.get("tools", toolId));
    expect(row?.name).toBe(name);
  });

  test("rejects a Category or Condition outside the fixed lists", async () => {
    const t = newTest();
    const anna = await seedViewer(t, ANNA);
    await expect(
      anna.as.mutation(api.tools.create, {
        ...drill,
        category: "weapons",
      } as never),
    ).rejects.toThrow();
    await expect(
      anna.as.mutation(api.tools.create, {
        ...drill,
        condition: "broken",
      } as never),
    ).rejects.toThrow();
  });

  test("never takes the owner from the arguments", async () => {
    const t = newTest();
    const anna = await seedViewer(t, ANNA);
    const omar = await seedViewer(t, OMAR);
    await expect(
      anna.as.mutation(api.tools.create, {
        ...drill,
        ownerId: omar.userId,
      } as never),
    ).rejects.toThrow();
    const rows = await t.run((ctx) => ctx.db.query("tools").collect());
    expect(rows).toHaveLength(0);
  });
});

async function annaWithDrill() {
  const t = newTest();
  const anna = await seedViewer(t, ANNA);
  const ben = await seedViewer(t, BEN);
  const omar = await seedViewer(t, OMAR);
  const toolId = await anna.as.mutation(api.tools.create, drill);
  const readTool = () => t.run((ctx) => ctx.db.get("tools", toolId));
  return { t, anna, ben, omar, toolId, readTool };
}

describe("RBAC matrix", () => {
  type Viewer = "signed out" | "other Member" | "owner" | "Admin";
  type Caller = Awaited<ReturnType<typeof seedViewer>>["as"];
  type Call = (as: Caller, toolId: Id<"tools">) => Promise<unknown>;

  type ToolFunction = keyof typeof toolsModule;

  const calls: Record<ToolFunction, Call> = {
    listPublic: (as) => as.query(api.tools.listPublic, {}),
    listBoard: (as) => as.query(api.tools.listBoard, {}),
    listMine: (as) => as.query(api.tools.listMine, {}),
    create: (as) => as.mutation(api.tools.create, drill),
    update: (as, toolId) =>
      as.mutation(api.tools.update, { toolId, ...drill, name: "Renamed" }),
    remove: (as, toolId) => as.mutation(api.tools.remove, { toolId }),
  };

  const OK = "ok";
  const matrix: [ToolFunction, Viewer, string][] = [
    ["listPublic", "signed out", OK],
    ["listPublic", "other Member", OK],
    ["listPublic", "owner", OK],
    ["listPublic", "Admin", OK],
    ["listBoard", "signed out", "UNAUTHENTICATED"],
    ["listBoard", "other Member", OK],
    ["listBoard", "owner", OK],
    ["listBoard", "Admin", OK],
    ["listMine", "signed out", "UNAUTHENTICATED"],
    ["listMine", "other Member", OK],
    ["listMine", "owner", OK],
    ["listMine", "Admin", OK],
    ["create", "signed out", "UNAUTHENTICATED"],
    ["create", "other Member", OK],
    ["create", "owner", OK],
    ["create", "Admin", OK],
    ["update", "signed out", "UNAUTHENTICATED"],
    ["update", "other Member", "NOT_FOUND"],
    ["update", "owner", OK],
    ["update", "Admin", "NOT_FOUND"],
    ["remove", "signed out", "UNAUTHENTICATED"],
    ["remove", "other Member", "NOT_FOUND"],
    ["remove", "owner", OK],
    ["remove", "Admin", "NOT_FOUND"],
  ];

  test("covers every public Tool function", () => {
    const exported = Object.keys(toolsModule).sort();
    expect(Object.keys(calls).sort()).toEqual(exported);
    expect([...new Set(matrix.map(([fn]) => fn))].sort()).toEqual(exported);
  });

  test.each(matrix)("tools.%s as %s → %s", async (fn, viewer, expected) => {
    const { t, anna, ben, omar, toolId } = await annaWithDrill();
    const as: Record<Viewer, Caller> = {
      "signed out": t,
      "other Member": ben.as,
      owner: anna.as,
      Admin: omar.as,
    };
    const result = calls[fn](as[viewer], toolId);
    if (expected === OK) {
      await result;
    } else {
      await expect(result).rejects.toMatchObject(rejectsWith(expected));
    }
  });
});

describe("tools.listBoard", () => {
  async function board() {
    const t = newTest();
    const anna = await seedViewer(t, { ...ANNA, trustedLender: true });
    const ben = await seedViewer(t, BEN);
    const drillId = await anna.as.mutation(api.tools.create, drill);
    const tentId = await ben.as.mutation(api.tools.create, {
      name: "Two-person tent",
      category: "camping",
      condition: "fair",
      description: "",
    });
    const goneId = await ben.as.mutation(api.tools.create, {
      ...drill,
      name: "Old sander",
    });
    await ben.as.mutation(api.tools.remove, { toolId: goneId });
    return { t, anna, ben, drillId, tentId };
  }

  test("lists every non-removed Tool with its Lender, Trusted badge and availability", async () => {
    const { ben, drillId, tentId } = await board();
    const rows = await ben.as.query(api.tools.listBoard, {});
    expect(rows).toHaveLength(2);
    expect(rows).toEqual(
      expect.arrayContaining([
        {
          _id: drillId,
          ...drill,
          lender: { name: "Anna Lee", trusted: true },
          isMine: false,
          myPendingRequest: false,
          availability: { kind: "available" },
        },
        {
          _id: tentId,
          name: "Two-person tent",
          category: "camping",
          condition: "fair",
          description: "",
          lender: { name: "Ben Ortiz", trusted: false },
          isMine: true,
          myPendingRequest: false,
          availability: { kind: "available" },
        },
      ]),
    );
  });

  test("filters by Category", async () => {
    const { anna, tentId } = await board();
    const rows = await anna.as.query(api.tools.listBoard, {
      category: "camping",
    });
    expect(rows.map((r) => r._id)).toEqual([tentId]);
    expect(
      await anna.as.query(api.tools.listBoard, { category: "kitchen" }),
    ).toEqual([]);
  });

  test("never contains an email address, even when a Lender's name fell back to it", async () => {
    const { t, anna } = await board();
    const nameless = await seedViewer(t, {
      subject: "user_nameless",
      name: "cara@example.com",
      email: "cara@example.com",
    });
    await nameless.as.mutation(api.tools.create, drill);

    const rows = await anna.as.query(api.tools.listBoard, {});
    expect(rows).toHaveLength(3);
    expect(JSON.stringify(rows)).not.toContain("@");
  });

  test("shows an Admin the same board as any Member", async () => {
    const { t, anna } = await board();
    const omar = await seedViewer(t, OMAR);
    const forAnna = await anna.as.query(api.tools.listBoard, {});
    const forOmar = await omar.as.query(api.tools.listBoard, {});
    expect(forOmar).toEqual(forAnna.map((row) => ({ ...row, isMine: false })));
  });
});

describe("tools.listMine", () => {
  test("lists only the caller's Tools, removed ones included and marked", async () => {
    const { anna, ben, toolId } = await annaWithDrill();
    const tentId = await anna.as.mutation(api.tools.create, {
      ...drill,
      name: "Tent",
      category: "camping",
    });
    await anna.as.mutation(api.tools.remove, { toolId: tentId });
    await ben.as.mutation(api.tools.create, { ...drill, name: "Ben's saw" });

    const rows = await anna.as.query(api.tools.listMine, {});
    expect(rows).toEqual([
      {
        _id: tentId,
        ...drill,
        name: "Tent",
        category: "camping",
        availability: null,
        removed: { at: expect.any(Number), reason: null },
      },
      {
        _id: toolId,
        ...drill,
        availability: { kind: "available" },
        removed: null,
      },
    ]);
  });
});

describe("tools.listPublic", () => {
  test("returns exactly name and Category of each Available Tool", async () => {
    const { t, anna } = await annaWithDrill();
    const gone = await anna.as.mutation(api.tools.create, {
      ...drill,
      name: "Gone",
    });
    await anna.as.mutation(api.tools.remove, { toolId: gone });

    const rows = await t.query(api.tools.listPublic, {});
    expect(rows).toEqual([{ name: drill.name, category: drill.category }]);
    for (const row of rows) {
      expect(Object.keys(row).sort()).toEqual(["category", "name"]);
    }
  });
});

describe("tools.update", () => {
  test("lets the owner change every field, validated like create", async () => {
    const { anna, toolId, readTool } = await annaWithDrill();
    await anna.as.mutation(api.tools.update, {
      toolId,
      name: " Hammer drill ",
      category: "hand_tools",
      condition: "worn",
      description: "Chuck sticks a bit.",
    });
    expect(await readTool()).toMatchObject({
      name: "Hammer drill",
      category: "hand_tools",
      condition: "worn",
      description: "Chuck sticks a bit.",
    });
    await expect(
      anna.as.mutation(api.tools.update, { toolId, ...drill, name: "" }),
    ).rejects.toMatchObject(rejectsWith("INVALID"));
  });

  test("gives another Member and an Admin NOT_FOUND and changes nothing", async () => {
    const { ben, omar, toolId, readTool } = await annaWithDrill();
    for (const viewer of [ben, omar]) {
      await expect(
        viewer.as.mutation(api.tools.update, {
          toolId,
          ...drill,
          name: "Mine now",
        }),
      ).rejects.toMatchObject(rejectsWith("NOT_FOUND"));
    }
    expect((await readTool())?.name).toBe(drill.name);
  });

  test("gives NOT_FOUND for a removed Tool", async () => {
    const { anna, toolId } = await annaWithDrill();
    await anna.as.mutation(api.tools.remove, { toolId });
    await expect(
      anna.as.mutation(api.tools.update, { toolId, ...drill }),
    ).rejects.toMatchObject(rejectsWith("NOT_FOUND"));
  });
});

describe("tools.remove", () => {
  test("soft-deletes the owner's Tool and records who removed it", async () => {
    const { anna, toolId, readTool } = await annaWithDrill();
    await anna.as.mutation(api.tools.remove, { toolId });
    const row = await readTool();
    expect(row).toMatchObject({ ...drill, removedBy: anna.userId });
    expect(row?.removedAt).toEqual(expect.any(Number));
  });

  test("audits the removal as tool.removed with the Lender as actor and no reason", async () => {
    const { t, anna, toolId, readTool } = await annaWithDrill();
    await anna.as.mutation(api.tools.remove, { toolId });
    expect(await t.run((ctx) => ctx.db.query("auditLog").collect())).toEqual([
      expect.objectContaining({
        actorId: anna.userId,
        action: "tool.removed",
        target: toolId,
      }),
    ]);
    expect((await readTool())?.removalReason).toBeUndefined();
  });

  test("gives another Member and an Admin NOT_FOUND and keeps the Tool", async () => {
    const { ben, omar, toolId, readTool } = await annaWithDrill();
    for (const viewer of [ben, omar]) {
      await expect(
        viewer.as.mutation(api.tools.remove, { toolId }),
      ).rejects.toMatchObject(rejectsWith("NOT_FOUND"));
    }
    expect((await readTool())?.removedAt).toBeUndefined();
  });

  test("gives NOT_FOUND when the Tool is already removed", async () => {
    const { anna, toolId } = await annaWithDrill();
    await anna.as.mutation(api.tools.remove, { toolId });
    await expect(
      anna.as.mutation(api.tools.remove, { toolId }),
    ).rejects.toMatchObject(rejectsWith("NOT_FOUND"));
  });
});
