# LendLoop

Borrow what you need. Lend what you don't. A neighbourhood tool-lending board built with Next.js,
a self-hosted Convex backend, Clerk sign-in, n8n automations and Mailpit, all running locally.

## Quick start

Prerequisites: Docker, Node 22 (`nvm use` reads `.nvmrc`), and a free Clerk account.

```sh
cp .env.example .env        # then paste the three Clerk values (checklist below)
docker compose up -d
npm install
npm run setup               # checks the Clerk values, configures and pushes Convex; safe to re-run
npm run dev                 # Next.js and Convex dev side by side
```

Open http://localhost:3000 and sign in. The board already shows demo data. To try every flow with
your own account, sign in once, then run `npm run demo -- you@example.com` (see
[Demo data](#demo-data)). To only make yourself an Admin, run `npm run promote -- you@example.com`.

### Clerk checklist

1. Create an application at https://dashboard.clerk.com (a development instance is fine).
2. **Configure → Integrations → Convex**: activate it and copy the **Frontend API URL** into
   `CLERK_FRONTEND_API_URL`.
3. **Sessions → Customize session token**: add these claims and save. Convex only sees what is in
   the session token, and LendLoop needs your email and name.
   ```json
   {
     "name": "{{user.full_name}}",
     "given_name": "{{user.first_name}}",
     "email": "{{user.primary_email_address}}"
   }
   ```
4. **Configure → API keys**: copy the **Publishable key** into `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY`
   and the **Secret key** into `CLERK_SECRET_KEY`.
5. Run `npm run setup` again.

## Local URLs

| Service          | URL                   | Notes                                               |
| ---------------- | --------------------- | --------------------------------------------------- |
| App              | http://localhost:3000 |                                                     |
| Convex dashboard | http://127.0.0.1:6791 | Admin key: `CONVEX_SELF_HOSTED_ADMIN_KEY` in `.env` |
| n8n              | http://localhost:5678 | `admin@lendloop.local` / `LendLoop-dev-1`           |
| Mailpit          | http://127.0.0.1:8025 | Catches every email                                 |

## Scripts

| Script                       | What it does                                                                        |
| ---------------------------- | ----------------------------------------------------------------------------------- |
| `npm run setup`              | Validates Clerk values, waits for Convex, sets function env vars, pushes functions  |
| `npm run dev`                | `next dev` and `convex dev` together                                                |
| `npm run check`              | Lint, typecheck and tests (also run in CI and pre-commit)                           |
| `npm run promote -- <email>` | Grants Admin through an internal Convex function                                    |
| `npm run demo -- <email>`    | Makes a signed-in Member an Admin with demo Requests of their own; safe to re-run   |
| `npm run reset`              | Wipes all LendLoop data in Convex and re-runs the base seed                         |
| `npm run test:n8n`           | Cross-service test against the running stack: Convex → n8n → Mailpit and back       |
| `npm run test:demo`          | Runs `demo` against the running stack and checks the Reminder arrives in Mailpit    |
| `npm run n8n:export`         | Re-exports workflows from n8n into `n8n/workflows/` and fails on secret-shaped data |

## Demo data

`npm run setup` runs the base seed (`internal.seed.base`), which is skipped if any Tool exists:

- 4 demo Members on `@example.com`; Priya Shah is a Trusted Lender. They have no Clerk account, so
  nobody can sign in as them.
- 8 Tools across every Category.
- 6 Requests: pending, approved (on loan now), returned, declined, cancelled, and one Overdue Loan
  (Tom has had Priya's Carpet cleaner for 3 days too long).
- An activity line on every Request, from `automationEvents` written as already sent. Seeding never
  emails anyone.

Every seeded row has `demo: true`.

`npm run demo -- <email>` (`internal.seed.demo`) needs that Member to have signed in once, and fails
with a clear message otherwise. It makes them an Admin and gives them:

- their own Pressure washer with a pending incoming Request from Marco;
- an Overdue Loan as Borrower (Priya's Tile cutter, due back 2 days ago);
- a pending Request of their own (Lena's Camping stove).

Running it again for the same email changes nothing more. Then **Admin → Run reminders now** sends
the Reminder for the Tile cutter to your address, and it shows up in Mailpit. All email, seeded or
not, goes to Mailpit; nothing leaves the machine.

`npm run reset` (`internal.seed.reset`) deletes every row in every table, the audit log and your own
`users` row included, cancels pending scheduled jobs and re-runs the base seed. Your account comes
back as a plain Member on your next page load, so run `npm run demo` again afterwards.

## Notifications

Creating a Request, or changing its status, queues a Notification in the same Convex transaction
(`automationEvents`, keyed `notify:<requestId>:<event>`). A Convex action signs the payload and
POSTs it to n8n, which verifies the signature, replies 202, deduplicates on `deliveryId`, sends the
email to Mailpit and writes `sent` or `failed` back to `POST /automation/notifications`.

- Signature (both directions): `X-LendLoop-Timestamp` and `X-LendLoop-Signature: v1=<hex>`, where
  `hex = HMAC-SHA256(secret, "<ts>.<METHOD>.<path>.<rawBody>")`, within ±300 s.
  `CONVEX_TO_N8N_SECRET` and `N8N_TO_CONVEX_SECRET` are separate.
- Delivery: 202 → accepted; 5xx, network error or a 10 s timeout → retried after 30 s, 2 min,
  10 min and 1 h, then failed; any other 4xx → failed at once.
- n8n starts through `n8n/entrypoint.sh`, which renders `n8n/credentials.template.json` from the
  container env, imports credentials and workflows, and publishes the trigger workflows. Workflows
  can't read env (`$env` stays blocked); secrets live only in n8n's Crypto credentials.

## Reminders

Every day at 09:00 in `APP_TIMEZONE` (n8n's `GENERIC_TIMEZONE`), the n8n reminder workflow makes a
signed `GET /automation/overdue-loans`. Convex answers with `asOf` (today in `APP_TIMEZONE`) and the
Overdue Loans that have no `sent` Reminder for that day, each with
`reminderKey = reminder:<loanId>:<asOf>`, and records `lastReminderRunAt`. n8n loops over them one
at a time: it emails the Borrower (3 tries, 5 s apart) and writes `sent` or `failed` back to the
signed, idempotent `POST /automation/reminders`. A failed email doesn't stop the loop; a write-back
that still fails after 3 tries stops the run.

- Running again the same day re-sends only Reminders that failed.
- `admin.runRemindersNow` (Admins only, audited) triggers a run at once through the signed n8n
  webhook `POST /webhook/reminders/run` (`N8N_REMINDERS_WEBHOOK_URL`, signed with
  `CONVEX_TO_N8N_SECRET`).
- Residual risk: if the email goes out but every write-back retry fails, a later run the same day
  sends one extra Reminder.

Every value in `.env.example` except the three Clerk values is a dev-only default. Never reuse them
in production.
