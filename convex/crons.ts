import { cronJobs } from "convex/server";
import { internal } from "./_generated/api";

const crons = cronJobs();

crons.hourly(
  "fail events n8n never confirmed",
  { minuteUTC: 17 },
  internal.automation.markStuckEvents,
  {},
);

// Hourly rather than daily at 10:00 because crons are UTC-only; the handler
// waits for 10:00 in APP_TIMEZONE.
crons.hourly(
  "check the daily reminder run happened",
  { minuteUTC: 5 },
  internal.automation.checkMissedReminderRun,
  {},
);

export default crons;
