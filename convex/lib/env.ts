// The only place function code reads process.env (lint rule off for this file).
export function appTimeZone(): string {
  return process.env.APP_TIMEZONE?.trim() || "UTC";
}
