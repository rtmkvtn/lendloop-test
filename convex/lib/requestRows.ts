import type { Doc, Id } from "../_generated/dataModel";
import type { QueryCtx } from "../_generated/server";
import { displayName, lenderOf } from "./members";
import { activityOf, automationEventsOf } from "./notifications";
import { isOverdue } from "./overdue";
import { allowedActions } from "./requestLifecycle";

export async function requestRow(
  ctx: QueryCtx,
  request: Doc<"requests">,
  viewerId: Id<"users">,
  today: string,
) {
  const [tool, lender, borrower, events] = await Promise.all([
    ctx.db.get("tools", request.toolId),
    ctx.db.get("users", request.lenderId),
    ctx.db.get("users", request.borrowerId),
    automationEventsOf(ctx, request._id),
  ]);
  const latest = events.at(-1);
  return {
    _id: request._id,
    _creationTime: request._creationTime,
    status: request.status,
    startDate: request.startDate,
    endDate: request.endDate,
    overdue: isOverdue(request, today),
    tool: {
      name: tool?.name ?? "A removed Tool",
      removed: !tool || tool.removedAt !== undefined,
    },
    lender: lenderOf(lender),
    borrower: { name: displayName(borrower) },
    actions: allowedActions(request, viewerId, today),
    activity: latest ? activityOf(latest) : null,
  };
}
