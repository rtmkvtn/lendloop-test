import { internal } from "./_generated/api";
import { appendAudit } from "./lib/audit";
import { adminMutation } from "./lib/functions";

export const runRemindersNow = adminMutation({
  args: {},
  handler: async (ctx) => {
    await appendAudit(ctx, {
      actorId: ctx.me._id,
      action: "reminders.run_now",
      target: ctx.me._id,
    });
    await ctx.scheduler.runAfter(0, internal.reminders.triggerRun, {});
  },
});
