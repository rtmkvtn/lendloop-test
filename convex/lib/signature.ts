// The signature spec shared by both directions (Convex → n8n and n8n → Convex).
export const TIMESTAMP_HEADER = "X-LendLoop-Timestamp";
export const SIGNATURE_HEADER = "X-LendLoop-Signature";
export const SIGNATURE_WINDOW_SECONDS = 300;

type Signed = { method: string; path: string; body: string };

const encoder = new TextEncoder();

function canonical(timestamp: string, { method, path, body }: Signed) {
  return `${timestamp}.${method}.${path}.${body}`;
}

async function hmacKey(secret: string) {
  return await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"],
  );
}

function toHex(bytes: ArrayBuffer) {
  return [...new Uint8Array(bytes)]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function fromHex(hex: string) {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return bytes;
}

export async function signedHeaders(
  secret: string,
  request: Signed,
  now: number = Date.now(),
) {
  const timestamp = String(Math.floor(now / 1000));
  const mac = await crypto.subtle.sign(
    "HMAC",
    await hmacKey(secret),
    encoder.encode(canonical(timestamp, request)),
  );
  return {
    [TIMESTAMP_HEADER]: timestamp,
    [SIGNATURE_HEADER]: `v1=${toHex(mac)}`,
  };
}

export async function verifySignature({
  secret,
  timestamp,
  signature,
  now = Date.now(),
  ...request
}: Signed & {
  secret: string;
  timestamp: string | null;
  signature: string | null;
  now?: number;
}): Promise<boolean> {
  if (!timestamp || !/^\d+$/.test(timestamp)) return false;
  const skew = Math.abs(Math.floor(now / 1000) - Number(timestamp));
  if (skew > SIGNATURE_WINDOW_SECONDS) return false;
  const match = /^v1=([0-9a-f]{64})$/.exec(signature ?? "");
  if (!match?.[1]) return false;
  // crypto.subtle.verify compares in constant time.
  return await crypto.subtle.verify(
    "HMAC",
    await hmacKey(secret),
    fromHex(match[1]),
    encoder.encode(canonical(timestamp, request)),
  );
}

export async function verifyRequest(secret: string, req: Request) {
  const body = await req.text();
  const ok = await verifySignature({
    secret,
    method: req.method,
    path: new URL(req.url).pathname,
    body,
    timestamp: req.headers.get(TIMESTAMP_HEADER),
    signature: req.headers.get(SIGNATURE_HEADER),
  });
  return ok ? { ok: true as const, body } : { ok: false as const };
}
