import { describe, expect, test } from "vitest";
import { securityHeaders } from "./security-headers";

// "verb-noun-00.clerk.accounts.dev$" in base64, the way Clerk encodes it.
const PK = `pk_test_${btoa("verb-noun-00.clerk.accounts.dev$")}`;

function csp(env: Parameters<typeof securityHeaders>[0]) {
  const header = securityHeaders(env).find(
    (h) => h.key === "Content-Security-Policy",
  );
  return Object.fromEntries(
    header!.value.split(";").map((d) => {
      const [name, ...sources] = d.trim().split(/\s+/);
      return [name, sources];
    }),
  ) as Record<string, string[]>;
}

const DEV = {
  publishableKey: PK,
  convexUrl: "http://127.0.0.1:3210",
  production: false,
};

describe("security headers", () => {
  test("let the app reach its Clerk Frontend API", () => {
    const policy = csp(DEV);
    const fapi = "https://verb-noun-00.clerk.accounts.dev";
    expect(policy["script-src"]).toContain(fapi);
    expect(policy["connect-src"]).toContain(fapi);
    expect(policy["img-src"]).toContain("https://img.clerk.com");
    expect(policy["frame-src"]).toContain("https://challenges.cloudflare.com");
    expect(policy["worker-src"]).toEqual(["'self'", "blob:"]);
  });

  test("let the app reach Convex over HTTP and its websocket", () => {
    expect(csp(DEV)["connect-src"]).toEqual(
      expect.arrayContaining(["http://127.0.0.1:3210", "ws://127.0.0.1:3210"]),
    );
    expect(
      csp({ ...DEV, convexUrl: "https://happy-cat-1.convex.cloud" })[
        "connect-src"
      ],
    ).toEqual(
      expect.arrayContaining([
        "https://happy-cat-1.convex.cloud",
        "wss://happy-cat-1.convex.cloud",
      ]),
    );
  });

  test("fall back to Clerk's development hosts when the key can't be decoded", () => {
    const policy = csp({ ...DEV, publishableKey: "pk_test_dummy" });
    expect(policy["script-src"]).toContain("https://*.clerk.accounts.dev");
    expect(policy["connect-src"]).toContain("https://*.clerk.accounts.dev");
  });

  test("forbid framing, plugins and foreign form targets", () => {
    const policy = csp(DEV);
    expect(policy["frame-ancestors"]).toEqual(["'none'"]);
    expect(policy["object-src"]).toEqual(["'none'"]);
    expect(policy["base-uri"]).toEqual(["'self'"]);
    expect(policy["form-action"]).toEqual(["'self'"]);
    expect(policy["default-src"]).toEqual(["'self'"]);
  });

  test("allow eval only in development", () => {
    expect(csp(DEV)["script-src"]).toContain("'unsafe-eval'");
    expect(csp({ ...DEV, production: true })["script-src"]).not.toContain(
      "'unsafe-eval'",
    );
  });

  test("set the companion headers, and HSTS only in production", () => {
    const keys = (production: boolean) =>
      Object.fromEntries(
        securityHeaders({ ...DEV, production }).map((h) => [h.key, h.value]),
      );
    expect(keys(false)).toMatchObject({
      "X-Content-Type-Options": "nosniff",
      "X-Frame-Options": "DENY",
      "Referrer-Policy": "strict-origin-when-cross-origin",
    });
    expect(keys(false)["Permissions-Policy"]).toContain("camera=()");
    expect(keys(false)["Strict-Transport-Security"]).toBeUndefined();
    expect(keys(true)["Strict-Transport-Security"]).toBe(
      "max-age=63072000; includeSubDomains",
    );
  });
});
