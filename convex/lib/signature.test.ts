import { describe, expect, test } from "vitest";
import { signedHeaders, verifySignature } from "./signature";

const SECRET = "n2c-test-secret";
const OTHER_DIRECTION_SECRET = "c2n-test-secret";
const NOW = Date.parse("2026-11-10T12:00:00Z");
const TS = "1794312000";
const BODY = '{"eventId":"x","status":"sent"}';
const POST = {
  method: "POST",
  path: "/automation/notifications",
  body: BODY,
};

// Computed independently with `openssl dgst -sha256 -hmac n2c-test-secret`.
const POST_VECTOR =
  "da2ef5b67b730c72b98fc9422277b331d23a42a3f5fb20a0c97e3d0aeb999c34";
const GET_VECTOR =
  "708c9d6844c953e1dfe92013ba74a0ebdd4e7bc49fd607c70b326fca5473db27";

function verify(
  overrides: Partial<{
    secret: string;
    method: string;
    path: string;
    body: string;
    timestamp: string | null;
    signature: string | null;
    now: number;
  }>,
) {
  return verifySignature({
    secret: SECRET,
    ...POST,
    timestamp: TS,
    signature: `v1=${POST_VECTOR}`,
    now: NOW,
    ...overrides,
  });
}

describe("signedHeaders", () => {
  test("signs `<ts>.<METHOD>.<path>.<rawBody>` with HMAC-SHA256", async () => {
    expect(await signedHeaders(SECRET, POST, NOW)).toEqual({
      "X-LendLoop-Timestamp": TS,
      "X-LendLoop-Signature": `v1=${POST_VECTOR}`,
    });
  });

  test("signs a GET with an empty body at the end of the string", async () => {
    expect(
      await signedHeaders(
        SECRET,
        { method: "GET", path: "/automation/overdue-loans", body: "" },
        NOW,
      ),
    ).toEqual({
      "X-LendLoop-Timestamp": TS,
      "X-LendLoop-Signature": `v1=${GET_VECTOR}`,
    });
  });
});

describe("verifySignature", () => {
  test("accepts a valid signature", async () => {
    expect(await verify({})).toBe(true);
  });

  test("accepts a signed GET", async () => {
    expect(
      await verify({
        method: "GET",
        path: "/automation/overdue-loans",
        body: "",
        signature: `v1=${GET_VECTOR}`,
      }),
    ).toBe(true);
  });

  test.each([
    ["a wrong secret", { secret: "nope" }],
    ["the other direction's secret", { secret: OTHER_DIRECTION_SECRET }],
    ["a tampered body", { body: BODY.replace("sent", "failed") }],
    ["another path", { path: "/automation/reminders" }],
    ["another method", { method: "PUT" }],
    ["a timestamp 301 s old", { now: NOW + 301_000 }],
    ["a timestamp 301 s in the future", { now: NOW - 301_000 }],
    ["a missing timestamp", { timestamp: null }],
    ["a missing signature", { signature: null }],
    ["a non-numeric timestamp", { timestamp: "1794312000.5" }],
    ["a signature without the v1= prefix", { signature: POST_VECTOR }],
    ["a truncated signature", { signature: `v1=${POST_VECTOR.slice(2)}` }],
  ])("rejects %s", async (_label, overrides) => {
    expect(await verify(overrides)).toBe(false);
  });

  test("accepts timestamps at the edge of the ±300 s window", async () => {
    expect(await verify({ now: NOW + 300_000 })).toBe(true);
    expect(await verify({ now: NOW - 300_000 })).toBe(true);
  });
});
