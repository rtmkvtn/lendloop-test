import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

export const vRole = v.union(v.literal("user"), v.literal("admin"));

export default defineSchema({
  users: defineTable({
    tokenIdentifier: v.string(),
    name: v.string(),
    // Stored only because Notifications and Reminders are addressed to it.
    email: v.string(),
    role: vRole,
    trustedLender: v.boolean(),
    demo: v.optional(v.boolean()),
  })
    .index("by_token", ["tokenIdentifier"])
    .index("by_email", ["email"]),
});
