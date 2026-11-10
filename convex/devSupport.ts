import { v } from "convex/values";
import { isCalendarDate } from "./lib/dates";
import { fail } from "./lib/errors";
import { internalMutation } from "./lib/functions";

// For `npm run test:n8n` only: a real backend has no fake clock, and Members
// can't create a Request that starts in the past.
export const backdateLoan = internalMutation({
  args: {
    requestId: v.id("requests"),
    startDate: v.string(),
    endDate: v.string(),
  },
  handler: async (ctx, { requestId, startDate, endDate }) => {
    const loan = await ctx.db.get("requests", requestId);
    if (!loan || loan.status !== "approved") {
      fail("NOT_FOUND", "No Loan with that id");
    }
    if (!isCalendarDate(startDate) || !isCalendarDate(endDate)) {
      fail("INVALID", "Dates must be YYYY-MM-DD");
    }
    await ctx.db.patch("requests", requestId, { startDate, endDate });
  },
});
