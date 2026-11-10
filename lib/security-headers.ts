// Static, so pages stay prerenderable: a nonce-based CSP would force every
// page to render dynamically. That is why script-src keeps 'unsafe-inline'.
const CLERK_DEV_HOSTS = "https://*.clerk.accounts.dev";

function clerkFrontendApi(publishableKey: string | undefined) {
  const encoded = publishableKey?.replace(/^pk_(test|live)_/, "");
  if (!encoded || encoded === publishableKey) return CLERK_DEV_HOSTS;
  try {
    const host = atob(encoded).replace(/\$$/, "");
    return /^[a-z0-9.-]+\.[a-z]{2,}$/i.test(host)
      ? `https://${host}`
      : CLERK_DEV_HOSTS;
  } catch {
    return CLERK_DEV_HOSTS;
  }
}

function convexOrigins(convexUrl: string | undefined) {
  if (!convexUrl) return [];
  try {
    const url = new URL(convexUrl);
    const ws = url.protocol === "https:" ? "wss:" : "ws:";
    return [url.origin, `${ws}//${url.host}`];
  } catch {
    return [];
  }
}

export function securityHeaders({
  publishableKey,
  convexUrl,
  production,
}: {
  publishableKey: string | undefined;
  convexUrl: string | undefined;
  production: boolean;
}) {
  const fapi = clerkFrontendApi(publishableKey);
  const clerkProtect = "https://*.protect.clerk.com";
  const turnstile = "https://challenges.cloudflare.com";
  const directives = [
    "default-src 'self'",
    [
      "script-src 'self' 'unsafe-inline'",
      production ? "" : "'unsafe-eval'",
      fapi,
      turnstile,
      clerkProtect,
    ],
    [
      "connect-src 'self'",
      fapi,
      `${clerkProtect}:*`,
      "https://clerk-telemetry.com https://*.clerk-telemetry.com",
      ...convexOrigins(convexUrl),
    ],
    "img-src 'self' data: https://img.clerk.com",
    "style-src 'self' 'unsafe-inline'",
    "font-src 'self'",
    "worker-src 'self' blob:",
    ["frame-src 'self'", turnstile, clerkProtect],
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
  ];
  const csp = directives
    .map((d) => (Array.isArray(d) ? d.filter(Boolean).join(" ") : d))
    .join("; ");

  return [
    { key: "Content-Security-Policy", value: csp },
    { key: "X-Content-Type-Options", value: "nosniff" },
    { key: "X-Frame-Options", value: "DENY" },
    { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
    {
      key: "Permissions-Policy",
      value: "camera=(), microphone=(), geolocation=(), payment=()",
    },
    ...(production
      ? [
          {
            key: "Strict-Transport-Security",
            value: "max-age=63072000; includeSubDomains",
          },
        ]
      : []),
  ];
}
