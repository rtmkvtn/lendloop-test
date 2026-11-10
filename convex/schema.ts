import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";
import { vCategory, vCondition } from "./lib/toolFields";

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

  tools: defineTable({
    ownerId: v.id("users"),
    name: v.string(),
    category: vCategory,
    condition: vCondition,
    description: v.string(),
    removedAt: v.optional(v.number()),
    removedBy: v.optional(v.id("users")),
    removalReason: v.optional(v.string()),
    demo: v.optional(v.boolean()),
  })
    .index("by_owner", ["ownerId"])
    .index("by_category", ["category", "removedAt"]),
});
