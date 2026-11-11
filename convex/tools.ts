import { v, type Infer } from "convex/values";
import type { Id } from "./_generated/dataModel";
import type { QueryCtx } from "./_generated/server";
import { availabilityOf } from "./lib/availability";
import { fail } from "./lib/errors";
import { lenderOf } from "./lib/members";
import { loansOf } from "./lib/requestLifecycle";
import {
  memberMutation,
  memberQuery,
  publicQuery,
  type Me,
} from "./lib/functions";
import {
  type Category,
  DESCRIPTION_MAX,
  NAME_MAX,
  vCategory,
  vCondition,
} from "./lib/toolFields";
import { removeFromBoard } from "./lib/toolRemoval";

const vToolFields = v.object({
  name: v.string(),
  category: vCategory,
  condition: vCondition,
  description: v.string(),
});

function cleanToolFields(fields: Infer<typeof vToolFields>) {
  const name = fields.name.trim();
  const description = fields.description.trim();
  if (!name) fail("INVALID", "Give the Tool a name.");
  if (name.length > NAME_MAX) {
    fail("INVALID", `Keep the name to ${NAME_MAX} characters.`);
  }
  if (description.length > DESCRIPTION_MAX) {
    fail("INVALID", `Keep the description to ${DESCRIPTION_MAX} characters.`);
  }
  return {
    name,
    category: fields.category,
    condition: fields.condition,
    description,
  };
}

async function loadOwnTool(ctx: QueryCtx & { me: Me }, toolId: Id<"tools">) {
  const tool = await ctx.db.get("tools", toolId);
  if (!tool || tool.removedAt !== undefined || tool.ownerId !== ctx.me._id) {
    fail("NOT_FOUND", "That Tool doesn't exist, or it isn't yours.");
  }
  return tool;
}

export const listBoard = memberQuery({
  args: { category: v.optional(vCategory) },
  handler: async (ctx, { category }) => {
    const tools = category
      ? await ctx.db
          .query("tools")
          .withIndex("by_category", (q) =>
            q.eq("category", category).eq("removedAt", undefined),
          )
          .order("desc")
          .collect()
      : (await ctx.db.query("tools").order("desc").collect()).filter(
          (tool) => tool.removedAt === undefined,
        );

    return await Promise.all(
      tools.map(async (tool) => {
        const lender = await ctx.db.get("users", tool.ownerId);
        return {
          _id: tool._id,
          name: tool.name,
          category: tool.category,
          condition: tool.condition,
          description: tool.description,
          lender: lenderOf(lender),
          isMine: tool.ownerId === ctx.me._id,
          availability: await availabilityOf(ctx, tool),
        };
      }),
    );
  },
});

export const listMine = memberQuery({
  args: {},
  handler: async (ctx) => {
    const tools = await ctx.db
      .query("tools")
      .withIndex("by_owner", (q) => q.eq("ownerId", ctx.me._id))
      .order("desc")
      .collect();

    return await Promise.all(
      tools.map(async (tool) => ({
        _id: tool._id,
        name: tool.name,
        category: tool.category,
        condition: tool.condition,
        description: tool.description,
        availability: await availabilityOf(ctx, tool),
        removed:
          tool.removedAt === undefined
            ? null
            : { at: tool.removedAt, reason: tool.removalReason ?? null },
      })),
    );
  },
});

export const listPublic = publicQuery({
  args: {},
  handler: async (ctx) => {
    const tools = await ctx.db.query("tools").order("desc").collect();
    const rows: { name: string; category: Category }[] = [];
    for (const tool of tools) {
      const availability = await availabilityOf(ctx, tool);
      if (availability?.kind !== "available") continue;
      rows.push({ name: tool.name, category: tool.category });
    }
    return rows;
  },
});

export const create = memberMutation({
  args: vToolFields.fields,
  handler: async (ctx, args) => {
    return await ctx.db.insert("tools", {
      ownerId: ctx.me._id,
      ...cleanToolFields(args),
    });
  },
});

export const update = memberMutation({
  args: { toolId: v.id("tools"), ...vToolFields.fields },
  handler: async (ctx, { toolId, ...fields }) => {
    await loadOwnTool(ctx, toolId);
    await ctx.db.patch("tools", toolId, cleanToolFields(fields));
  },
});

export const remove = memberMutation({
  args: { toolId: v.id("tools") },
  handler: async (ctx, { toolId }) => {
    const tool = await loadOwnTool(ctx, toolId);
    if ((await loansOf(ctx, toolId)).length > 0) {
      fail(
        "CONFLICT",
        "This Tool has an active or upcoming Loan: mark it returned, or wait until it ends.",
      );
    }
    await removeFromBoard(ctx, tool, { actorId: ctx.me._id });
  },
});
