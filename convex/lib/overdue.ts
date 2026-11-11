import type { Doc } from "../_generated/dataModel";
import type { QueryCtx } from "../_generated/server";

export function hasEnded(
  request: Pick<Doc<"requests">, "endDate">,
  today: string,
) {
  return request.endDate < today;
}

export function isOverdue(
  request: Pick<Doc<"requests">, "status" | "endDate">,
  today: string,
) {
  return request.status === "approved" && hasEnded(request, today);
}

// The index range form of isOverdue, for queries over every Loan.
export function overdueLoans(ctx: QueryCtx, today: string) {
  return ctx.db
    .query("requests")
    .withIndex("by_status_endDate", (q) =>
      q.eq("status", "approved").lt("endDate", today),
    );
}
