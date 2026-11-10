import type { Doc } from "../_generated/dataModel";
import type { QueryCtx } from "../_generated/server";

// Worked out when read, never stored. Loans arrive with the Request lifecycle
// (#22), which adds the "booked from", "on loan" and "overdue" states here.
export type Availability = { kind: "available" };

export async function availabilityOf(
  _ctx: QueryCtx,
  tool: Doc<"tools">,
): Promise<Availability | null> {
  if (tool.removedAt !== undefined) return null;
  return { kind: "available" };
}
