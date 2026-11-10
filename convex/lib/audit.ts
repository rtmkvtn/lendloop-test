import type { Id } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";

// The only writer of auditLog, and it only ever inserts.
export async function appendAudit(
  ctx: MutationCtx,
  entry: {
    actorId: Id<"users">;
    action: string;
    target: Id<"requests"> | Id<"tools"> | Id<"users"> | Id<"automationEvents">;
  },
) {
  await ctx.db.insert("auditLog", { ...entry, at: Date.now() });
}
