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

| Script                       | What it does                                                                       |
| ---------------------------- | ---------------------------------------------------------------------------------- |
| `npm run setup`              | Validates Clerk values, waits for Convex, sets function env vars, pushes functions |
| `npm run dev`                | `next dev` and `convex dev` together                                               |
| `npm run check`              | Lint, typecheck and tests (also run in CI and pre-commit)                          |
| `npm run promote -- <email>` | Grants Admin through an internal Convex function                                   |

Every value in `.env.example` except the three Clerk values is a dev-only default. Never reuse them
in production.
