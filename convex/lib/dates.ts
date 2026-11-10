// Dates are calendar days as `YYYY-MM-DD`, compared as strings.
import { appTimeZone } from "./env";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const DAY_MS = 86_400_000;

export function todayInAppTimeZone(now: number = Date.now()): string {
  // en-CA formats as YYYY-MM-DD.
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: appTimeZone(),
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(now));
}

function toUtcMs(date: string) {
  const [y, m, d] = date.split("-").map(Number) as [number, number, number];
  return Date.UTC(y, m - 1, d);
}

export function isCalendarDate(value: string): boolean {
  if (!DATE_RE.test(value)) return false;
  return new Date(toUtcMs(value)).toISOString().slice(0, 10) === value;
}

export function addDays(date: string, days: number): string {
  return new Date(toUtcMs(date) + days * DAY_MS).toISOString().slice(0, 10);
}

export function daysInclusive(start: string, end: string): number {
  return Math.round((toUtcMs(end) - toUtcMs(start)) / DAY_MS) + 1;
}

export function rangesOverlap(
  a: { startDate: string; endDate: string },
  b: { startDate: string; endDate: string },
): boolean {
  return a.startDate <= b.endDate && b.startDate <= a.endDate;
}
