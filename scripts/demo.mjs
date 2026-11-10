// npm run demo -- <email>: sets up a signed-in reviewer for every flow. Safe to re-run.
import { convex, die, loadDotEnv } from "./lib.mjs";

const email = process.argv[2]?.trim();
if (!email || !/^[^\s@]+@[^\s@]+$/.test(email)) {
  die("Usage: npm run demo -- <email>   (sign in to the app once first)");
}

loadDotEnv();
const result = await convex(["run", "seed:demo", JSON.stringify({ email })], {
  timeoutMs: 30_000,
  quiet: true,
});
if (!result.ok) {
  const notFound = /No Member with email [^"\n]*/.exec(result.output);
  die(notFound ? notFound[0] : `Demo setup failed:\n${result.output.trim()}`);
}

const { created } = JSON.parse(result.stdout);
console.log(`✔ ${email.toLowerCase()} is an Admin`);
console.log(
  created
    ? "✔ Added your Pressure washer with a pending incoming Request, an Overdue Loan (Tile cutter) and a pending Request of your own (Camping stove)"
    : "✔ Your demo Tool and Requests already exist (npm run reset starts over)",
);
console.log(`
Next: reload http://localhost:3000, open Admin and click "Run reminders now".
The Reminder for your Overdue Loan lands in Mailpit: http://127.0.0.1:8025
`);
