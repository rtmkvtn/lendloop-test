// The only module allowed to import the raw function builders (enforced by
// ESLint). Every public function is built from a wrapper here.
import {
  customCtx,
  customMutation,
  customQuery,
} from "convex-helpers/server/customFunctions";
import type { UserIdentity } from "convex/server";
import type { Doc } from "../_generated/dataModel";
import {
  mutation as rawMutation,
  query as rawQuery,
  type QueryCtx,
} from "../_generated/server";
import { fail } from "./errors";

export {
  httpAction,
  internalAction,
  internalMutation,
  internalQuery,
} from "../_generated/server";

export type Me = Doc<"users">;

async function loadMe(ctx: QueryCtx): Promise<Me | null> {
  const identity = await ctx.auth.getUserIdentity();
  if (!identity) return null;
  return await ctx.db
    .query("users")
    .withIndex("by_token", (q) =>
      q.eq("tokenIdentifier", identity.tokenIdentifier),
    )
    .unique();
}

async function requireMe(ctx: QueryCtx): Promise<Me> {
  const me = await loadMe(ctx);
  if (!me) fail("UNAUTHENTICATED", "Sign in to continue");
  return me;
}

async function requireAdmin(ctx: QueryCtx): Promise<Me> {
  const me = await requireMe(ctx);
  if (me.role !== "admin") fail("FORBIDDEN", "Admins only");
  return me;
}

export const publicQuery = customQuery(
  rawQuery,
  customCtx(async (ctx) => ({ me: await loadMe(ctx) })),
);

export const memberQuery = customQuery(
  rawQuery,
  customCtx(async (ctx) => ({ me: await requireMe(ctx) })),
);

export const memberMutation = customMutation(
  rawMutation,
  customCtx(async (ctx) => ({ me: await requireMe(ctx) })),
);

export const adminQuery = customQuery(
  rawQuery,
  customCtx(async (ctx) => ({ me: await requireAdmin(ctx) })),
);

export const adminMutation = customMutation(
  rawMutation,
  customCtx(async (ctx) => ({ me: await requireAdmin(ctx) })),
);

// For users.ensureMe only: it runs before the caller's users row exists.
export const signedInMutation = customMutation(
  rawMutation,
  customCtx(async (ctx): Promise<{ identity: UserIdentity }> => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) fail("UNAUTHENTICATED", "Sign in to continue");
    return { identity };
  }),
);
