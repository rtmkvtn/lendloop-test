// The only place function code reads process.env (lint rule off for this file).
export function appTimeZone(): string {
  return process.env.APP_TIMEZONE?.trim() || "UTC";
}

function optional(name: string): string | undefined {
  return process.env[name]?.trim() || undefined;
}

export function appUrl(): string {
  return (optional("APP_URL") ?? "http://localhost:3000").replace(/\/+$/, "");
}

export function convexToN8nSecret() {
  return optional("CONVEX_TO_N8N_SECRET");
}

export function n8nToConvexSecret() {
  return optional("N8N_TO_CONVEX_SECRET");
}

export function n8nNotifyWebhookUrl() {
  return optional("N8N_NOTIFY_WEBHOOK_URL");
}
