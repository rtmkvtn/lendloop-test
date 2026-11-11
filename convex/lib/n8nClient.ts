import { signedHeaders } from "./signature";

const TIMEOUT_MS = 10_000;

export function parseHttpUrl(raw: string | undefined): URL | null {
  if (!raw) return null;
  try {
    const url = new URL(raw);
    return ["http:", "https:"].includes(url.protocol) ? url : null;
  } catch {
    return null;
  }
}

export async function postSigned(
  url: URL,
  secret: string,
  body: string,
): Promise<{ status: number } | { error: string }> {
  const headers = {
    "Content-Type": "application/json",
    ...(await signedHeaders(secret, {
      method: "POST",
      path: url.pathname,
      body,
    })),
  };
  try {
    const res = await fetch(url.href, {
      method: "POST",
      headers,
      body,
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    return { status: res.status };
  } catch (e) {
    const timedOut =
      e instanceof Error && ["TimeoutError", "AbortError"].includes(e.name);
    return {
      error: timedOut
        ? "n8n did not answer within 10 s"
        : "Could not reach n8n",
    };
  }
}
