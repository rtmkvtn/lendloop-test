import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";
import { pendingRequestsOf, transitionRequest } from "./requestLifecycle";

// A pending Request is auto-declined when its Tool is removed (GLOSSARY).
// Approved Loans are left alone: callers decide whether one blocks removal.
export async function removeFromBoard(
  ctx: MutationCtx,
  tool: Doc<"tools">,
  by: { actorId: Id<"users">; reason?: string },
) {
  for (const request of await pendingRequestsOf(ctx, tool._id)) {
    await transitionRequest(ctx, request, "declined", {
      actorId: by.actorId,
      auto: true,
    });
  }
  await ctx.db.patch("tools", tool._id, {
    removedAt: Date.now(),
    removedBy: by.actorId,
    ...(by.reason === undefined ? {} : { removalReason: by.reason }),
  });
}
