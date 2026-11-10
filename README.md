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

Open http://localhost:3000 and sign in. To make yourself an Admin, sign in once, then run
`npm run promote -- you@example.com`.

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
| `npm run test:n8n`           | Cross-service test against the running stack: Convex → n8n → Mailpit and back       |
| `npm run n8n:export`         | Re-exports workflows from n8n into `n8n/workflows/` and fails on secret-shaped data |
| `npm run demo:break-smtp`    | Points n8n's SMTP credential at a dead port, so every email fails                   |
| `npm run demo:fix-smtp`      | Points it back at Mailpit                                                           |

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

## Failure visibility

No automation fails silently.

- **Members** see a failed Notification or Reminder in red on the Request's activity line and in its
  drawer ("Request email to lender failed, retrying", "Reminder failed").
- **Error Workflow** (`LendLoop: error handler`, `n8n/workflows/error.json`) is the
  `settings.errorWorkflow` of both workflows. It must be published, or n8n refuses to call it.
  For every failed production run it emails `ADMIN_ALERT_EMAIL` (default `alerts@lendloop.local`,
  in Mailpit) with the workflow, the failed node, the error (addresses scrubbed) and the execution
  link, and no payload. It then makes a signed `POST /automation/errors`, which records a
  `workflow_error` keyed `workflow_error:n8n:<executionId>`, so a repeat is a no-op. The alert
  address reaches the workflow as a `${ADMIN_ALERT_EMAIL}` placeholder that `entrypoint.sh` renders
  at start, because workflows can't read env; `npm run n8n:export` puts the placeholder back.
- **Stuck events:** an hourly Convex cron (`:17` UTC) marks events `failed` with "No confirmation
  from n8n" once they have waited over 30 minutes for n8n's write-back.
- **Missed run:** Convex crons are UTC-only, so an hourly cron (`:05` UTC) checks whether it's past
  10:00 in `APP_TIMEZONE`. If any Loan is Overdue and the last reminder run wasn't today, it records
  a `workflow_error` "Reminder run missed", once per day.
- **Run reminders now:** if Convex can't start the n8n run (not configured, unreachable, non-2xx),
  that's recorded as a `workflow_error` too.
- **Automation health** (Admin page) lists failed and stuck events, each with **Retry**, the 20 most
  recent workflow errors with links to their n8n executions, and the last reminder run time.
  `admin.retryEvent` (audited) keeps the event's row and idempotency key and bumps
  `retryGeneration`, which changes the `deliveryId` n8n dedupes on, so the retry isn't dropped.
  A Notification is delivered again with a fresh backoff; a Reminder triggers a reminder run, and
  only while its Loan is still Overdue. `tool.removed` Notifications have no Request, so they show
  here with their Tool's name.
- n8n keeps failed executions (`EXECUTIONS_DATA_SAVE_ON_ERROR=all`) and prunes after 14 days.

**Try it:** `npm run demo:break-smtp`, then create a Request (or press "Run reminders now" with an
Overdue Loan). The activity line turns red and Automation health lists the event. Run
`npm run demo:fix-smtp` and press Retry. A failed email alone doesn't fail the n8n run (it's
written back as `failed`); the alert email fires for run-level failures such as a write-back that
Convex keeps rejecting. `npm run test:n8n` forces one by giving Convex the wrong
`N8N_TO_CONVEX_SECRET` for a moment.

Every value in `.env.example` except the three Clerk values is a dev-only default. Never reuse them
in production.
