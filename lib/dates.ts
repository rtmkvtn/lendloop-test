export { addDays } from "@/convex/lib/dates";

// The browser's own today. The server re-checks every date in APP_TIMEZONE.
export function localToday() {
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

const DAY_FORMAT = new Intl.DateTimeFormat("en-GB", {
  day: "numeric",
  month: "short",
  year: "numeric",
  timeZone: "UTC",
});

export function formatDay(date: string) {
  return DAY_FORMAT.format(new Date(`${date}T00:00:00Z`));
}

export function formatRange(startDate: string, endDate: string) {
  return startDate === endDate
    ? formatDay(startDate)
    : `${formatDay(startDate)} – ${formatDay(endDate)}`;
}

const MOMENT_FORMAT = new Intl.DateTimeFormat("en-GB", {
  dateStyle: "medium",
  timeStyle: "short",
});

export function formatMoment(ms: number) {
  return MOMENT_FORMAT.format(new Date(ms));
}

function localDay(ms: number) {
  const d = new Date(ms);
  return Date.UTC(d.getFullYear(), d.getMonth(), d.getDate());
}

export function relativeDay(ms: number, now: number = Date.now()) {
  const days = Math.round((localDay(now) - localDay(ms)) / 86_400_000);
  if (days <= 0) return "today";
  if (days === 1) return "yesterday";
  return `${days} days ago`;
}
