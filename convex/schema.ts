import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";
import { vRequestStatus } from "./lib/requestFields";
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

  requests: defineTable({
    toolId: v.id("tools"),
    borrowerId: v.id("users"),
    lenderId: v.id("users"),
    startDate: v.string(),
    endDate: v.string(),
    status: vRequestStatus,
    decidedAt: v.optional(v.number()),
    returnedAt: v.optional(v.number()),
    cancelledAt: v.optional(v.number()),
    demo: v.optional(v.boolean()),
  })
    .index("by_tool_status", ["toolId", "status"])
    .index("by_borrower", ["borrowerId"])
    .index("by_lender_status", ["lenderId", "status"])
    .index("by_status_endDate", ["status", "endDate"]),

  // Append-only: rows are inserted through lib/audit.ts and never patched or deleted.
  auditLog: defineTable({
    actorId: v.id("users"),
    action: v.string(),
    target: v.union(v.id("requests"), v.id("tools"), v.id("users")),
    at: v.number(),
    demo: v.optional(v.boolean()),
  }).index("by_target", ["target"]),
});
