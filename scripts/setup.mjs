// npm run setup: safe to re-run. Order matters: Clerk values → Convex up →
// function env vars → first push (auth.config.ts needs CLERK_FRONTEND_API_URL).
import { CONVEX_URL, convex, die, loadDotEnv, waitFor } from "./lib.mjs";

const CLERK_VALUES = [
  {
    name: "NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY",
    pattern: /^pk_test_[A-Za-z0-9_-]+=*$/,
    hint: "starts with pk_test_",
  },
  {
    name: "CLERK_SECRET_KEY",
    pattern: /^sk_test_[A-Za-z0-9]+$/,
    hint: "starts with sk_test_",
  },
  {
    name: "CLERK_FRONTEND_API_URL",
    pattern: /^https:\/\/[a-z0-9-]+\.clerk\.accounts\.dev$/,
    hint: "looks like https://verb-noun-00.clerk.accounts.dev, no trailing slash",
  },
];

const SESSION_CLAIMS = `{ "name": "{{user.full_name}}", "given_name": "{{user.first_name}}", "email": "{{user.primary_email_address}}" }`;

function clerkChecklist(problems) {
  return [
    "LendLoop needs three values from your own Clerk development app:",
    ...problems.map((p) => `  • ${p}`),
    "",
    "Clerk checklist:",
    "  1. Create a free application at https://dashboard.clerk.com (a development instance is fine).",
    "  2. Configure → Integrations → Convex: activate it and copy the Frontend API URL.",
    "  3. Sessions → Customize session token: add these claims and save:",
    `       ${SESSION_CLAIMS}`,
    "     (Convex only sees claims in the session token; without email, sign-in fails.)",
    "  4. Configure → API keys: copy the Publishable key and the Secret key.",
    "  5. Paste the three values into .env:",
    ...CLERK_VALUES.map((v) => `       ${v.name}=…   (${v.hint})`),
    "  6. Run `npm run setup` again.",
  ].join("\n");
}

if (!loadDotEnv()) {
  die(
    "No .env file. Run `cp .env.example .env` first.\n\n" +
      clerkChecklist(["missing .env"]),
  );
}

const problems = CLERK_VALUES.flatMap(({ name, pattern, hint }) => {
  const value = process.env[name]?.trim() ?? "";
  if (!value) return [`${name} is missing`];
  if (!pattern.test(value)) return [`${name} looks malformed (${hint})`];
  return [];
});
if (problems.length > 0) die(clerkChecklist(problems));
console.log("✔ Clerk values look well-formed");

console.log(`… waiting for Convex at ${CONVEX_URL}/version`);
if (!(await waitFor(`${CONVEX_URL}/version`, 120_000))) {
  die(
    "Convex is not reachable from this machine.\n" +
      "  Is the stack running? `docker compose up -d`\n" +
      "  If the container is healthy but unreachable, try `docker compose up -d --force-recreate convex-backend`.",
  );
}
console.log("✔ Convex is up");

// A wrong admin key makes the CLI retry forever instead of failing.
const auth = await convex(["env", "list"], { timeoutMs: 20_000, quiet: true });
if (!auth.ok) {
  die(
    "The Convex CLI could not authenticate with CONVEX_SELF_HOSTED_ADMIN_KEY.\n" +
      "  Check that CONVEX_INSTANCE_NAME, CONVEX_INSTANCE_SECRET and CONVEX_SELF_HOSTED_ADMIN_KEY in .env match .env.example.",
  );
}

const functionEnv = {
  CLERK_FRONTEND_API_URL: process.env.CLERK_FRONTEND_API_URL.trim(),
  APP_TIMEZONE: process.env.APP_TIMEZONE?.trim() || "UTC",
};
for (const [name, value] of Object.entries(functionEnv)) {
  const set = await convex(["env", "set", name, value], { quiet: true });
  if (!set.ok) die(`Could not set ${name} on Convex:\n${set.output}`);
}
console.log(`✔ Convex env set: ${Object.keys(functionEnv).join(", ")}`);

console.log("… pushing Convex functions");
const push = await convex(["dev", "--once"]);
if (!push.ok) die("Pushing Convex functions failed (see above).");
console.log("✔ Convex functions pushed");

for (const [name, url] of [
  ["n8n", "http://127.0.0.1:5678/healthz"],
  ["Mailpit", "http://127.0.0.1:8025/readyz"],
]) {
  const up = await waitFor(url, 5_000);
  console.log(up ? `✔ ${name} is up` : `! ${name} is not up yet (${url})`);
}

console.log(`
Setup complete. Next: npm run dev

  App               http://localhost:3000
  Convex dashboard  http://127.0.0.1:6791  (admin key: CONVEX_SELF_HOSTED_ADMIN_KEY in .env)
  n8n               http://localhost:5678  (admin@lendloop.local / LendLoop-dev-1)
  Mailpit           http://127.0.0.1:8025
`);
