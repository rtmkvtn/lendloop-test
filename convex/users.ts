import { v } from "convex/values";
import { fail } from "./lib/errors";
import { promoteByEmail } from "./lib/members";
import {
  internalMutation,
  publicQuery,
  signedInMutation,
} from "./lib/functions";

const MISSING_EMAIL =
  "Your Clerk session token has no email claim. In the Clerk dashboard open Sessions → Customize session token and add the email, name and given_name claims (README, Clerk checklist), then sign out and in again.";

const normaliseEmail = (email: string) => email.trim().toLowerCase();

export const ensureMe = signedInMutation({
  args: {},
  handler: async (ctx) => {
    const { identity } = ctx;
    if (!identity.email) fail("INVALID", MISSING_EMAIL);
    const email = normaliseEmail(identity.email);
    const name = identity.name?.trim() || identity.givenName?.trim() || email;
    const firstName =
      identity.givenName?.trim() ||
      identity.name?.trim().split(/\s+/)[0] ||
      email.split("@")[0] ||
      email;

    const existing = await ctx.db
      .query("users")
      .withIndex("by_token", (q) =>
        q.eq("tokenIdentifier", identity.tokenIdentifier),
      )
      .unique();

    if (existing) {
      if (
        existing.name !== name ||
        existing.firstName !== firstName ||
        existing.email !== email
      ) {
        await ctx.db.patch("users", existing._id, { name, firstName, email });
      }
      return existing._id;
    }

    return await ctx.db.insert("users", {
      tokenIdentifier: identity.tokenIdentifier,
      name,
      firstName,
      email,
      role: "user",
      trustedLender: false,
    });
  },
});

export const me = publicQuery({
  args: {},
  handler: async (ctx) => {
    if (!ctx.me) return null;
    const { _id, name, email, role, trustedLender } = ctx.me;
    return { _id, name, email, role, trustedLender };
  },
});

export const promote = internalMutation({
  args: { email: v.string() },
  handler: async (ctx, args) => {
    const email = normaliseEmail(args.email);
    const user = await promoteByEmail(ctx, email);
    if (!user) {
      fail(
        "NOT_FOUND",
        `No Member with email ${email}. They must sign in once before they can be promoted.`,
      );
    }
    return { email: user.email, role: "admin" as const };
  },
});
