import { v } from "convex/values";
import type { Doc, Id, TableNames } from "./_generated/dataModel";
import type { MutationCtx } from "./_generated/server";
import type { NotificationEvent } from "./lib/automationFields";
import { addDays, todayInAppTimeZone } from "./lib/dates";
import { fail } from "./lib/errors";
import { internalMutation } from "./lib/functions";
import { promoteByEmail } from "./lib/members";
import { recipientOf } from "./lib/notifications";
import { REMINDER_EVENT, reminderKeyOf } from "./lib/reminders";
import type { Category, Condition } from "./lib/toolFields";
import schema from "./schema";

const DAY_MS = 86_400_000;

// Not a Clerk issuer, so nobody can ever sign in as a demo Member.
const DEMO_ISSUER = "demo";

const MEMBERS = {
  priya: { name: "Priya Shah", trustedLender: true },
  tom: { name: "Tom Becker", trustedLender: false },
  lena: { name: "Lena Fischer", trustedLender: false },
  marco: { name: "Marco Rossi", trustedLender: false },
} as const;

type MemberKey = keyof typeof MEMBERS;
type Members = Record<MemberKey, Id<"users">>;

type ToolSpec = {
  name: string;
  category: Category;
  condition: Condition;
  description: string;
};

const TOOLS: (ToolSpec & { owner: MemberKey })[] = [
  {
    owner: "priya",
    name: "Cordless drill",
    category: "power_tools",
    condition: "good",
    description: "18V with two batteries and a set of wood and masonry bits.",
  },
  {
    owner: "tom",
    name: "Orbital sander",
    category: "power_tools",
    condition: "fair",
    description: "Works well; bring your own sanding discs (125 mm).",
  },
  {
    owner: "lena",
    name: "Socket set",
    category: "hand_tools",
    condition: "good",
    description: "94 pieces, metric and imperial, in a carry case.",
  },
  {
    owner: "marco",
    name: "Hedge trimmer",
    category: "garden",
    condition: "worn",
    description: "Electric, 55 cm blade. Needs a long extension cable.",
  },
  {
    owner: "lena",
    name: "Stand mixer",
    category: "kitchen",
    condition: "new",
    description: "With dough hook, whisk and flat beater.",
  },
  {
    owner: "tom",
    name: "Four-person tent",
    category: "camping",
    condition: "good",
    description: "Pitches in ten minutes. Footprint and pegs included.",
  },
  {
    owner: "priya",
    name: "Carpet cleaner",
    category: "cleaning",
    condition: "fair",
    description: "Upright wet cleaner. Please empty the tank before returning.",
  },
  {
    owner: "marco",
    name: "Extension ladder",
    category: "other",
    condition: "good",
    description: "Aluminium, extends to 6 m. Fits in an estate car.",
  },
];

const EVENTS_UP_TO: Record<Doc<"requests">["status"], NotificationEvent[]> = {
  pending: ["request.created"],
  approved: ["request.created", "request.approved"],
  declined: ["request.created", "request.declined"],
  cancelled: ["request.created", "request.cancelled"],
  returned: ["request.created", "request.approved", "request.returned"],
};

const TIMESTAMP_FIELD = {
  approved: "decidedAt",
  declined: "decidedAt",
  cancelled: "cancelledAt",
} as const;

const emailOf = (key: MemberKey) => `${key}@example.com`;

async function ensureDemoMembers(ctx: MutationCtx): Promise<Members> {
  const ids = {} as Members;
  for (const [key, member] of Object.entries(MEMBERS) as [
    MemberKey,
    (typeof MEMBERS)[MemberKey],
  ][]) {
    const tokenIdentifier = `${DEMO_ISSUER}|${key}`;
    const existing = await ctx.db
      .query("users")
      .withIndex("by_token", (q) => q.eq("tokenIdentifier", tokenIdentifier))
      .unique();
    ids[key] =
      existing?._id ??
      (await ctx.db.insert("users", {
        tokenIdentifier,
        name: member.name,
        firstName: member.name.split(" ")[0]!,
        email: emailOf(key),
        role: "user",
        trustedLender: member.trustedLender,
        demo: true,
      }));
  }
  return ids;
}

const insertTool = (ctx: MutationCtx, ownerId: Id<"users">, tool: ToolSpec) =>
  ctx.db.insert("tools", { ownerId, ...tool, demo: true });

// Inserted as already sent: seeding must never email anyone.
async function insertRequest(
  ctx: MutationCtx,
  spec: {
    tool: Doc<"tools">;
    borrowerId: Id<"users">;
    status: Doc<"requests">["status"];
    from: number;
    to: number;
  },
) {
  const now = Date.now();
  const today = todayInAppTimeZone(now);
  const startDate = addDays(today, spec.from);
  const endDate = addDays(today, spec.to);
  const askedAt = now + Math.min(spec.from - 2, -1) * DAY_MS;
  const decidedAt = askedAt + DAY_MS / 2;
  const settled =
    spec.status === "returned"
      ? { decidedAt, returnedAt: now + (spec.to + 1) * DAY_MS }
      : spec.status === "pending"
        ? {}
        : { [TIMESTAMP_FIELD[spec.status]]: decidedAt };

  const request = {
    toolId: spec.tool._id,
    borrowerId: spec.borrowerId,
    lenderId: spec.tool.ownerId,
    startDate,
    endDate,
    status: spec.status,
    ...settled,
    demo: true,
  };
  const requestId = await ctx.db.insert("requests", request);

  const events = EVENTS_UP_TO[spec.status];
  for (const [i, event] of events.entries()) {
    const updatedAt =
      i === 0
        ? askedAt
        : event === "request.returned"
          ? settled.returnedAt!
          : decidedAt;
    await ctx.db.insert("automationEvents", {
      requestId,
      kind: "notification",
      event,
      idempotencyKey: `notify:${requestId}:${event}`,
      recipientId: recipientOf(request, event),
      status: "sent",
      attempts: 1,
      updatedAt,
      demo: true,
    });
  }
  return requestId;
}

async function seedBase(ctx: MutationCtx) {
  if (await ctx.db.query("tools").first()) return { seeded: false };

  const members = await ensureDemoMembers(ctx);
  const tools: Record<string, Doc<"tools">> = {};
  for (const { owner, ...spec } of TOOLS) {
    const id = await insertTool(ctx, members[owner], spec);
    tools[spec.name] = (await ctx.db.get("tools", id))!;
  }

  const ask = (
    toolName: string,
    borrower: MemberKey,
    status: Doc<"requests">["status"],
    from: number,
    to: number,
  ) =>
    insertRequest(ctx, {
      tool: tools[toolName]!,
      borrowerId: members[borrower],
      status,
      from,
      to,
    });

  await ask("Cordless drill", "tom", "pending", 3, 5);
  await ask("Four-person tent", "lena", "approved", -1, 4);
  await ask("Socket set", "marco", "returned", -14, -10);
  await ask("Stand mixer", "priya", "declined", 7, 8);
  await ask("Hedge trimmer", "lena", "cancelled", 2, 3);
  const overdueId = await ask("Carpet cleaner", "tom", "approved", -8, -3);

  const yesterday = addDays(todayInAppTimeZone(), -1);
  await ctx.db.insert("automationEvents", {
    requestId: overdueId,
    kind: "reminder",
    event: REMINDER_EVENT,
    idempotencyKey: reminderKeyOf(overdueId, yesterday),
    recipientId: members.tom,
    status: "sent",
    attempts: 1,
    updatedAt: Date.now() - DAY_MS,
    demo: true,
  });

  return { seeded: true };
}

export const base = internalMutation({
  args: {},
  handler: async (ctx) => await seedBase(ctx),
});

export const reset = internalMutation({
  args: {},
  handler: async (ctx) => {
    for (const table of Object.keys(schema.tables) as TableNames[]) {
      for (const row of await ctx.db.query(table).collect()) {
        await ctx.db.delete(table, row._id);
      }
    }
    for (const job of await ctx.db.system
      .query("_scheduled_functions")
      .collect()) {
      if (job.state.kind === "pending") await ctx.scheduler.cancel(job._id);
    }
    return await seedBase(ctx);
  },
});

const REVIEWER_TOOL: ToolSpec = {
  name: "Pressure washer",
  category: "cleaning",
  condition: "good",
  description: "140 bar, with patio cleaner attachment and a 10 m hose.",
};

const OVERDUE_TOOL: ToolSpec = {
  name: "Tile cutter",
  category: "hand_tools",
  condition: "good",
  description: "Manual, cuts tiles up to 60 cm. Spare scoring wheel included.",
};

const WANTED_TOOL: ToolSpec = {
  name: "Camping stove",
  category: "camping",
  condition: "new",
  description: "Two burners, runs on a standard gas cartridge.",
};

export const demo = internalMutation({
  args: { email: v.string() },
  handler: async (ctx, args) => {
    const email = args.email.trim().toLowerCase();
    const reviewer = await promoteByEmail(ctx, email);
    if (!reviewer) {
      fail(
        "NOT_FOUND",
        `No Member with email ${email}. Sign in to LendLoop once with that account, then run npm run demo again.`,
      );
    }

    const ownTools = await ctx.db
      .query("tools")
      .withIndex("by_owner", (q) => q.eq("ownerId", reviewer._id))
      .collect();
    if (ownTools.some((tool) => tool.demo)) return { email, created: false };

    const members = await ensureDemoMembers(ctx);
    const toolOf = async (ownerId: Id<"users">, spec: ToolSpec) =>
      (await ctx.db.get("tools", await insertTool(ctx, ownerId, spec)))!;

    await insertRequest(ctx, {
      tool: await toolOf(reviewer._id, REVIEWER_TOOL),
      borrowerId: members.marco,
      status: "pending",
      from: 4,
      to: 6,
    });
    await insertRequest(ctx, {
      tool: await toolOf(members.priya, OVERDUE_TOOL),
      borrowerId: reviewer._id,
      status: "approved",
      from: -7,
      to: -2,
    });
    await insertRequest(ctx, {
      tool: await toolOf(members.lena, WANTED_TOOL),
      borrowerId: reviewer._id,
      status: "pending",
      from: 5,
      to: 7,
    });
    return { email, created: true };
  },
});
