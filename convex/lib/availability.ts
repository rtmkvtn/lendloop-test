import type { Doc } from "../_generated/dataModel";
import type { QueryCtx } from "../_generated/server";
import { addDays, todayInAppTimeZone } from "./dates";
import { isOverdue } from "./overdue";
import { loansOf } from "./requestLifecycle";

// Worked out when read, never stored.
export type Availability =
  | { kind: "available"; bookedFrom?: string }
  | { kind: "on_loan"; until: string }
  | { kind: "overdue"; since: string };

export async function availabilityOf(
  ctx: QueryCtx,
  tool: Doc<"tools">,
  today: string = todayInAppTimeZone(),
): Promise<Availability | null> {
  if (tool.removedAt !== undefined) return null;
  const loans = await loansOf(ctx, tool._id);

  const overdue = loans
    .filter((loan) => isOverdue(loan, today))
    .map((loan) => loan.endDate)
    .sort()[0];
  if (overdue) return { kind: "overdue", since: addDays(overdue, 1) };

  const current = loans.find((loan) => loan.startDate <= today);
  if (current) return { kind: "on_loan", until: current.endDate };

  const next = loans.map((loan) => loan.startDate).sort()[0];
  return next ? { kind: "available", bookedFrom: next } : { kind: "available" };
}
