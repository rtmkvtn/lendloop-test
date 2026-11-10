import { spawn } from "node:child_process";
import { existsSync } from "node:fs";

export const CONVEX_URL = "http://127.0.0.1:3210";

export function loadDotEnv() {
  if (!existsSync(".env")) return false;
  process.loadEnvFile(".env");
  return true;
}

export function convex(args, { timeoutMs, quiet = false } = {}) {
  return new Promise((resolve) => {
    const child = spawn("npx", ["convex", ...args], {
      stdio: ["ignore", quiet ? "pipe" : "inherit", quiet ? "pipe" : "inherit"],
      shell: process.platform === "win32",
    });
    let output = "";
    child.stdout?.on("data", (d) => (output += d));
    child.stderr?.on("data", (d) => (output += d));
    const timer = timeoutMs
      ? setTimeout(() => {
          child.kill();
          resolve({ ok: false, timedOut: true, output });
        }, timeoutMs)
      : undefined;
    child.on("exit", (code) => {
      clearTimeout(timer);
      resolve({ ok: code === 0, timedOut: false, output });
    });
  });
}

export async function waitFor(url, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(3000) });
      if (res.ok) return true;
    } catch {
      // not up yet
    }
    await new Promise((r) => setTimeout(r, 1000));
  }
  return false;
}

export function die(message) {
  console.error(`\n✖ ${message}\n`);
  process.exit(1);
}
