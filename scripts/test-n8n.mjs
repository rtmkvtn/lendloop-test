// npm run test:n8n: the Convex ↔ n8n ↔ Mailpit seam, against the running compose
// stack (`docker compose up -d && npm run setup` first). Signs with node:crypto,
// independently of convex/lib/signature.ts, so the two implementations check each other.
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { before, describe, test } from "node:test";
import { CONVEX_URL, convex, loadDotEnv, waitFor } from "./lib.mjs";

if (!loadDotEnv()) throw new Error("No .env file. Run `cp .env.example .env`.");

const N8N = "http://127.0.0.1:5678";
const WEBHOOK_PATH = "/webhook/lendloop/request-event";
const MAILPIT = "http://127.0.0.1:8025";
const C2N = process.env.CONVEX_TO_N8N_SECRET;
const N2C = process.env.N8N_TO_CONVEX_SECRET;
const RUN = Date.now().toString(36);
const ISSUER = "https://lendloop.test";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function identity(who, givenName) {
  return {
    issuer: ISSUER,
    subject: `n8n-test-${who}-${RUN}`,
    name: `${givenName} Test`,
    givenName,
    email: `${who}-${RUN}@example.com`,
  };
}

async function convexRun(args) {
  const res = await convex(["run", ...args], {
    quiet: true,
    timeoutMs: 60_000,
  });
  if (!res.ok) throw new Error(`convex run ${args[0]} failed:\n${res.output}`);
  return res.stdout.trim() ? JSON.parse(res.stdout) : null;
}

const call = (fn, args, as) =>
  convexRun([fn, JSON.stringify(args), "--identity", JSON.stringify(as)]);

const inlineQuery = (js) => convexRun(["--inline-query", js]);

function addDaysUtc(days) {
  return new Date(Date.now() + days * 86_400_000).toISOString().slice(0, 10);
}

async function postToN8n(
  body,
  { secret = C2N, ts, signed = true, path = WEBHOOK_PATH } = {},
) {
  const timestamp = ts ?? String(Math.floor(Date.now() / 1000));
  const headers = { "content-type": "application/json" };
  if (signed) {
    const hex = createHmac("sha256", secret)
      .update(`${timestamp}.POST.${path}.${body}`)
      .digest("hex");
    headers["x-lendloop-timestamp"] = timestamp;
    headers["x-lendloop-signature"] = `v1=${hex}`;
  }
  return await fetch(`${N8N}${path}`, {
    method: "POST",
    headers,
    body,
    signal: AbortSignal.timeout(15_000),
  });
}

async function mailCount(to) {
  const query = encodeURIComponent(`to:"${to}"`);
  const res = await fetch(`${MAILPIT}/api/v1/search?query=${query}&limit=50`);
  const data = await res.json();
  return { count: data.messages_count, messages: data.messages };
}

async function until(probe, what, timeoutMs = 30_000) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = await probe();
    if (value) return value;
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${what}`);
    await sleep(1000);
  }
}

async function eventRow(key) {
  const rows = await inlineQuery(
    `await ctx.db.query("automationEvents").withIndex("by_idempotency_key", (q) => q.eq("idempotencyKey", ${JSON.stringify(key)})).collect()`,
  );
  return rows[0];
}

const anna = identity("anna", "Anna");
const ben = identity("ben", "Ben");
let requestId;
let event;

function payload(overrides = {}) {
  return JSON.stringify({
    eventId: event._id,
    deliveryId: `${event._id}#0`,
    sentAt: new Date().toISOString(),
    event: "request.created",
    recipient: { email: anna.email, firstName: "Anna" },
    tool: { name: `Test ladder ${RUN}` },
    dates: { start: addDaysUtc(2), end: addDaysUtc(3) },
    link: `http://localhost:3000/incoming?request=${requestId}`,
    ...overrides,
  });
}

before(async () => {
  for (const [name, url] of [
    ["Convex", `${CONVEX_URL}/version`],
    ["n8n", `${N8N}/healthz`],
    ["Mailpit", `${MAILPIT}/readyz`],
  ]) {
    if (!(await waitFor(url, 60_000))) {
      throw new Error(`${name} is not reachable at ${url}. Is the stack up?`);
    }
  }
  await call("users:ensureMe", {}, anna);
  await call("users:ensureMe", {}, ben);
  const toolId = await call(
    "tools:create",
    {
      name: `Test ladder ${RUN}`,
      category: "hand_tools",
      condition: "good",
      description: "Created by npm run test:n8n.",
    },
    anna,
  );
  requestId = await call(
    "requests:create",
    { toolId, startDate: addDaysUtc(2), endDate: addDaysUtc(3) },
    ben,
  );
});

describe("Notifications through the real stack", () => {
  test("a new Request emails the Lender and the event ends sent in Convex", async () => {
    const key = `notify:${requestId}:request.created`;
    const { messages } = await until(async () => {
      const mail = await mailCount(anna.email);
      return mail.count >= 1 && mail;
    }, "the email to the Lender");
    assert.equal(messages.length, 1);
    assert.match(messages[0].Subject, /^New request for your Test ladder/);

    event = await until(async () => {
      const row = await eventRow(key);
      return row?.status === "sent" && row;
    }, "the event to be sent");
    assert.equal(event.attempts, 1);
  });

  test("the same deliveryId again gets 202 but no second email", async () => {
    const res = await postToN8n(payload());
    assert.equal(res.status, 202);
    await sleep(5000);
    assert.equal((await mailCount(anna.email)).count, 1);
  });

  test("a signed POST with a new deliveryId gets 202 and an email", async () => {
    const to = `direct-${RUN}@example.com`;
    const res = await postToN8n(
      payload({
        deliveryId: `${event._id}#direct`,
        recipient: { email: to, firstName: "Dee" },
      }),
    );
    assert.equal(res.status, 202);
    const mail = await until(async () => {
      const m = await mailCount(to);
      return m.count >= 1 && m;
    }, "the direct email");
    assert.equal(mail.count, 1);
    assert.equal((await eventRow(event.idempotencyKey)).status, "sent");
  });

  for (const [label, options] of [
    ["unsigned", { signed: false }],
    ["signed with the n8n → Convex secret", { secret: N2C }],
    ["stale (400 s old)", { ts: String(Math.floor(Date.now() / 1000) - 400) }],
    ["from the future", { ts: String(Math.floor(Date.now() / 1000) + 400) }],
  ]) {
    test(`a POST that is ${label} gets 401 and no email`, async () => {
      const to = `rejected-${RUN}@example.com`;
      const res = await postToN8n(
        payload({
          deliveryId: `${event._id}#${label}`,
          recipient: { email: to, firstName: "Rex" },
        }),
        options,
      );
      assert.equal(res.status, 401);
      await sleep(1000);
      assert.equal((await mailCount(to)).count, 0);
    });
  }
});

describe("Reminders through the real stack", () => {
  const REMINDERS_PATH = "/webhook/reminders/run";
  const omar = identity("omar", "Omar");
  const borrowers = [identity("cleo", "Cleo"), identity("dev", "Dev")];
  const loanIds = [];

  const remindersOf = (loanId) =>
    inlineQuery(
      `(await ctx.db.query("automationEvents").withIndex("by_request", (q) => q.eq("requestId", ${JSON.stringify(loanId)})).collect()).filter((e) => e.kind === "reminder")`,
    );

  const lastRunAt = async () =>
    (
      await inlineQuery(
        `await ctx.db.query("automationState").withIndex("by_key", (q) => q.eq("key", "reminders")).unique()`,
      )
    )?.lastReminderRunAt ?? 0;

  // Borrowers also get the approval Notification, so count Reminders by subject.
  const reminderMail = async (to) =>
    (await mailCount(to)).messages.filter((m) =>
      m.Subject.startsWith("Reminder: "),
    );

  const sentCounts = async () =>
    await Promise.all(
      borrowers.map(async (b) => (await reminderMail(b.email)).length),
    );

  before(async () => {
    await call("users:ensureMe", {}, omar);
    await convexRun(["users:promote", JSON.stringify({ email: omar.email })]);
    for (const [i, borrower] of borrowers.entries()) {
      await call("users:ensureMe", {}, borrower);
      const toolId = await call(
        "tools:create",
        {
          name: `Test hedge trimmer ${i} ${RUN}`,
          category: "garden",
          condition: "good",
          description: "Created by npm run test:n8n.",
        },
        anna,
      );
      const loanId = await call(
        "requests:create",
        { toolId, startDate: addDaysUtc(2), endDate: addDaysUtc(3) },
        borrower,
      );
      await call("requests:approve", { requestId: loanId }, anna);
      await convexRun([
        "devSupport:backdateLoan",
        JSON.stringify({
          requestId: loanId,
          startDate: addDaysUtc(-6 - i),
          endDate: addDaysUtc(-2 - i),
        }),
      ]);
      loanIds.push(loanId);
    }
  });

  test("Run reminders now emails each Overdue Borrower once and marks the Reminder sent", async () => {
    await call("admin:runRemindersNow", {}, omar);
    for (const [i, borrower] of borrowers.entries()) {
      const messages = await until(async () => {
        const mail = await reminderMail(borrower.email);
        return mail.length >= 1 && mail;
      }, `the Reminder to ${borrower.givenName}`);
      assert.equal(messages.length, 1);
      assert.match(
        messages[0].Subject,
        new RegExp(
          `^Reminder: the Test hedge trimmer ${i} ${RUN} was due back`,
        ),
      );
      const [row] = await until(async () => {
        const rows = await remindersOf(loanIds[i]);
        return rows[0]?.status === "sent" && rows;
      }, `the Reminder for ${borrower.givenName} to be sent`);
      assert.match(row.idempotencyKey, /^reminder:[^:]+:\d{4}-\d{2}-\d{2}$/);
      assert.equal(row.attempts, 1);
    }
  });

  test("a second run the same day sends no second email", async () => {
    const before = await lastRunAt();
    const res = await postToN8n(
      JSON.stringify({ requestedAt: new Date().toISOString() }),
      { path: REMINDERS_PATH },
    );
    assert.equal(res.status, 202);
    await until(
      async () => (await lastRunAt()) > before,
      "the second run to reach Convex",
    );
    await sleep(5000);
    assert.deepEqual(await sentCounts(), [1, 1]);
    for (const loanId of loanIds) {
      assert.equal((await remindersOf(loanId)).length, 1);
    }
  });

  for (const [label, options] of [
    ["unsigned", { signed: false }],
    ["signed with the n8n → Convex secret", { secret: N2C }],
    ["stale (400 s old)", { ts: String(Math.floor(Date.now() / 1000) - 400) }],
  ]) {
    test(`a manual trigger that is ${label} gets 401 and starts no run`, async () => {
      const before = await lastRunAt();
      const res = await postToN8n("{}", { ...options, path: REMINDERS_PATH });
      assert.equal(res.status, 401);
      await sleep(2000);
      assert.equal(await lastRunAt(), before);
    });
  }
});
