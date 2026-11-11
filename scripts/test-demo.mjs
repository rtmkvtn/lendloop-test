// npm run test:demo: `npm run demo` against the running compose stack, ending with
// the reviewer's Reminder in Mailpit (`docker compose up -d && npm run setup` first).
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { before, test } from "node:test";
import { CONVEX_URL, convex, loadDotEnv, waitFor } from "./lib.mjs";

if (!loadDotEnv()) throw new Error("No .env file. Run `cp .env.example .env`.");

const MAILPIT = "http://127.0.0.1:8025";
const RUN = Date.now().toString(36);
const reviewer = {
  issuer: "https://lendloop.test",
  subject: `demo-test-${RUN}`,
  name: "Rhea Test",
  givenName: "Rhea",
  email: `rhea-${RUN}@example.com`,
};

async function convexRun(args) {
  const res = await convex(["run", ...args], {
    quiet: true,
    timeoutMs: 60_000,
  });
  if (!res.ok) throw new Error(`convex run ${args[0]} failed:\n${res.output}`);
  return res.stdout.trim() ? JSON.parse(res.stdout) : null;
}

const asReviewer = (fn, args = {}) =>
  convexRun([fn, JSON.stringify(args), "--identity", JSON.stringify(reviewer)]);

const npmRunDemo = (email) =>
  spawnSync(process.execPath, ["scripts/demo.mjs", email], {
    encoding: "utf8",
  });

async function remindersTo(to) {
  const query = encodeURIComponent(`to:"${to}"`);
  const res = await fetch(`${MAILPIT}/api/v1/search?query=${query}&limit=50`);
  const { messages } = await res.json();
  return messages.filter((m) => m.Subject.startsWith("Reminder: "));
}

before(async () => {
  for (const url of [`${CONVEX_URL}/version`, `${MAILPIT}/readyz`]) {
    if (!(await waitFor(url, 60_000))) {
      throw new Error(`${url} is not reachable. Is the stack up?`);
    }
  }
});

test("demo fails clearly for a Member who has never signed in", () => {
  const res = npmRunDemo(`never-${RUN}@example.com`);
  assert.equal(res.status, 1);
  assert.match(
    res.stderr,
    /No Member with email never-.*Sign in to LendLoop once/,
  );
});

test("demo sets the reviewer up once, however often it runs", async () => {
  await asReviewer("users:ensureMe");
  for (let i = 0; i < 2; i++) {
    const res = npmRunDemo(reviewer.email);
    assert.equal(res.status, 0, res.stderr);
  }
  assert.equal((await asReviewer("users:me")).role, "admin");
  assert.equal((await asReviewer("tools:listMine")).length, 1);
  const incoming = await asReviewer("requests:listIncoming");
  assert.deepEqual(
    incoming.map((r) => r.status),
    ["pending"],
  );
  const mine = await asReviewer("requests:listMine");
  assert.deepEqual(mine.map((r) => [r.status, r.overdue]).sort(), [
    ["approved", true],
    ["pending", false],
  ]);
});

test("Run reminders now lands a Reminder in the reviewer's Mailpit inbox", async () => {
  await asReviewer("admin:runRemindersNow");
  const deadline = Date.now() + 60_000;
  let messages = [];
  while (messages.length === 0 && Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 1000));
    messages = await remindersTo(reviewer.email);
  }
  assert.equal(messages.length, 1);
  assert.match(messages[0].Subject, /^Reminder: the Tile cutter was due back/);
});
