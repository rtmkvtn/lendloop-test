// npm run promote -- <email>: the only way to grant Admin. Runs the internal
// users:promote function with the deployment admin key; no client can call it.
import { convex, die, loadDotEnv } from "./lib.mjs";

const email = process.argv[2]?.trim();
if (!email || !/^[^\s@]+@[^\s@]+$/.test(email)) {
  die("Usage: npm run promote -- <email>");
}

loadDotEnv();
const result = await convex(
  ["run", "users:promote", JSON.stringify({ email })],
  { timeoutMs: 30_000, quiet: true },
);
if (!result.ok) {
  die(`Promotion failed:\n${result.output.trim()}`);
}
console.log(`✔ ${email.toLowerCase()} is now an Admin`);
