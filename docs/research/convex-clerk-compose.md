# Research: self-hosted Convex + Clerk in one docker-compose for a reviewer

Ticket: rtmkvtn/lendloop-test#3 (map #1). Researched 2026-11-10 against primary sources: the
`get-convex/convex-backend` repo, the `clerk/javascript` and `clerk/cli` repos, docs.convex.dev,
clerk.com/docs, and the npm and ghcr registries. Context7 was not authorised in this session, so
the docs were read directly. Claims marked **[unverified]** were inferred, not observed. A spike
should confirm them.

## TL;DR

- **Self-hosted Convex in compose: yes, as a first-class path.** There are two images,
  `ghcr.io/convex/convex-backend` and `ghcr.io/convex/convex-dashboard`. The ports are 3210 (API),
  3211 (HTTP actions) and 6791 (dashboard). It stores data in SQLite on a volume by default. You
  point `npx convex dev` at it with `CONVEX_SELF_HOSTED_URL` and `CONVEX_SELF_HOSTED_ADMIN_KEY`.
  Crons and the scheduler work, because self-hosted "supports all the free-tier features".
- **Compose-internal networking works both ways.** Action `fetch()` in the stock self-hosted image
  is not screened for SSRF, so `fetch("http://n8n:5678/webhook/…")` is allowed. n8n reaches HTTP
  actions at `http://convex-backend:3211/…`.
- **Admin key can be made deterministic.** The key is derived from `INSTANCE_NAME` +
  `INSTANCE_SECRET`. If `.env.example` pins both (dev-only values), the admin key is fixed and can
  ship in `.env.example`. The reviewer never runs `generate_admin_key.sh`.
- **Clerk "keyless mode" in Next.js is gone.** `@clerk/nextjs` 7.8.0 (2026-08-20) removed it. With
  no keys set, the SDK now throws and tells you to run `npx clerk@latest init`. The replacement is
  the Clerk CLI's **accountless app**: `npx clerk@latest init` creates an unclaimed development
  application and writes the keys to `.env.local` without signup or login.
- **Accountless Clerk + Convex is not plug-and-play.** The stock `ConvexProviderWithClerk` asks for
  the `convex` JWT template unless the session token carries `aud: "convex"`. On an accountless
  app neither exists, because both need a dashboard step. A small adapter plus a `customJwt`
  provider makes it work in principle **[unverified]**. The documented path needs a Clerk account.
- **Recommendation:**
  - Primary path: the reviewer creates a free Clerk dev app (about 3 minutes), clicks
    "Activate Convex integration", and pastes 3 values: publishable key, secret key, and Frontend
    API URL.
  - Stretch path: spike the zero-account route (`clerk init` accountless + `customJwt`). Keep it
    only if it works end to end.

## 1. Self-hosted Convex in docker-compose

### Images, ports, storage

The official compose file is `self-hosted/docker/docker-compose.yml`
([source](https://github.com/get-convex/convex-backend/blob/main/self-hosted/docker/docker-compose.yml)).

**Services**

- `backend` runs `ghcr.io/convex/convex-backend:latest`. It publishes `3210` (API) and `3211`
  (site proxy = HTTP actions), and keeps data on the volume `data:/convex/data`.
- Its healthcheck is `curl -f http://localhost:3210/version`.
- `dashboard` runs `ghcr.io/convex/convex-dashboard:latest` on `6791`. Its
  `depends_on: backend: condition: service_healthy`.

**Default URLs** ([self-hosted README](https://github.com/get-convex/convex-backend/blob/main/self-hosted/README.md))

- dashboard: `http://localhost:6791`
- backend: `http://127.0.0.1:3210`
- HTTP actions: `http://127.0.0.1:3211`

**Storage and limits**

- The default store is SQLite at `/convex/data/db.sqlite3`. `POSTGRES_URL` or `MYSQL_URL` switch
  it to Postgres or MySQL. `DATABASE_URL` is deprecated
  ([run_backend.sh](https://github.com/get-convex/convex-backend/blob/main/self-hosted/docker-build/run_backend.sh)).
  For a take-home, SQLite on a volume is enough, so Convex does not need the n8n Postgres.
- The defaults also include 16 concurrent queries, mutations and actions, and
  `DOCUMENT_RETENTION_DELAY=172800` (2 days).
- The images are multi-arch (`linux/arm64` and `linux/amd64`), as seen in the ghcr manifest for
  `latest`. That covers Apple Silicon reviewers.

### Env vars that matter

These are read by the compose file or `run_backend.sh`.

| Var                                                             | Default                                                                                | Meaning                                                                                                         |
| --------------------------------------------------------------- | -------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| `CONVEX_CLOUD_ORIGIN`                                           | `http://127.0.0.1:3210`                                                                | Public URL of the API, as seen by clients                                                                       |
| `CONVEX_SITE_ORIGIN`                                            | `http://127.0.0.1:3211`                                                                | Public URL of HTTP actions, as seen by clients                                                                  |
| `NEXT_PUBLIC_DEPLOYMENT_URL` (dashboard)                        | `http://127.0.0.1:3210`                                                                | API URL the dashboard's browser calls                                                                           |
| `INSTANCE_NAME`                                                 | `convex-self-hosted`                                                                   | Instance name; an input to the admin key                                                                        |
| `INSTANCE_SECRET`                                               | random `openssl rand -hex 32`, persisted to `/convex/data/credentials/instance_secret` | An input to the admin key                                                                                       |
| `POSTGRES_URL` / `MYSQL_URL`                                    | unset → SQLite                                                                         | External DB                                                                                                     |
| `DISABLE_BEACON`                                                | unset                                                                                  | Set it to stop the telemetry beacon                                                                             |
| `DO_NOT_REQUIRE_SSL`                                            | unset                                                                                  | Allow non-SSL DB connections (only relevant with Postgres or MySQL)                                             |
| `V8_ACTION_USER_TIMEOUT_SECS` / `NODE_ACTION_USER_TIMEOUT_SECS` | 1800 / 600                                                                             | Action timeouts ([knobs.rs](https://github.com/get-convex/convex-backend/blob/main/crates/common/src/knobs.rs)) |

`CONVEX_CLOUD_ORIGIN` and `CONVEX_SITE_ORIGIN` "show up in storage urls, action callbacks, etc."
(comment in `run_backend.sh`). Keep them at the host-reachable `127.0.0.1` values, because the
browser and `npm run dev` run on the host. Containers address the backend by service name instead.

**Gotcha:** compose `environment:` configures the _backend process_. It does **not** populate
`process.env` inside Convex functions. Function env vars such as `CLERK_FRONTEND_API_URL` and
`N8N_WEBHOOK_URL` are set per deployment with `npx convex env set …` or in the dashboard
([upgrading.md](https://github.com/get-convex/convex-backend/blob/main/self-hosted/advanced/upgrading.md)
uses `npx convex env list/set` against self-hosted). A bootstrap script must run those commands.

### Admin key

The documented command is `docker compose exec backend ./generate_admin_key.sh`
([README](https://github.com/get-convex/convex-backend/blob/main/self-hosted/README.md)). The
script computes `./generate_key "$INSTANCE_NAME" "$INSTANCE_SECRET"`
([generate_admin_key.sh](https://github.com/get-convex/convex-backend/blob/main/self-hosted/docker-build/generate_admin_key.sh)).
It reads the same credentials that the backend uses
([read_credentials.sh](https://github.com/get-convex/convex-backend/blob/main/self-hosted/docker-build/read_credentials.sh)).

So pin `INSTANCE_SECRET` (a dev-only hex string) and `INSTANCE_NAME` in `.env.example`, run the
script once, and commit the resulting key to `.env.example` as `CONVEX_SELF_HOSTED_ADMIN_KEY`. The
key is stable across `docker compose down -v`, because the env var takes precedence over the
persisted file. The derivation is deterministic by construction **[unverified]**: the script shows
it only takes those two inputs, but I have not run it twice to compare.

### Pointing the CLI at it

Put this in `.env.local`, not committed
([README](https://github.com/get-convex/convex-backend/blob/main/self-hosted/README.md),
[hosting_on_own_infra.md](https://github.com/get-convex/convex-backend/blob/main/self-hosted/advanced/hosting_on_own_infra.md)):

```sh
CONVEX_SELF_HOSTED_URL='http://127.0.0.1:3210'
CONVEX_SELF_HOSTED_ADMIN_KEY='<admin key>'
```

Then `npx convex dev` pushes code and watches. The README says self-hosting needs a recent
`convex` npm package, and the current version is `1.49.0` (npm, 2026-10-30).

The Next.js client also needs `NEXT_PUBLIC_CONVEX_URL=http://127.0.0.1:3210`. Whether
`npx convex dev` writes that variable automatically in self-hosted mode is **[unverified]**, so
put it in `.env.example` explicitly.

The dashboard login takes the deployment URL plus the admin key.

### HTTP actions and networking between compose services

- **HTTP actions** are served on container port `3211`, the site proxy.
  - From the host: `http://127.0.0.1:3211/<route>`.
  - From another container on the compose network, such as n8n: `http://convex-backend:3211/<route>`.
- **Outbound `fetch` from actions** goes through reqwest. Requests pass through an SSRF-screening
  proxy only when the backend is started with `--convex-http-proxy`. The flag's description reads
  "Optional proxy for Actions fetches … to screen it for SSRF attacks"
  ([local_backend config.rs](https://github.com/get-convex/convex-backend/blob/main/crates/local_backend/src/config.rs),
  [common/http/fetch.rs](https://github.com/get-convex/convex-backend/blob/main/crates/common/src/http/fetch.rs)).
- The stock image's `run_backend.sh` does **not** pass that flag. As a result, fetches to
  private-IP or compose DNS names such as `http://n8n:5678` and `http://mailpit:8025` are not
  blocked. Docker's embedded DNS resolves those names (standard Docker behaviour). That resolution
  was not observed end to end here **[unverified at runtime]**.
- Use the service name, not `localhost`. Inside the backend container, `localhost` is the backend
  itself.

### Scheduler / crons

The self-hosted README says self-hosting "supports all the free-tier features of the cloud
product". Scheduled functions (`ctx.scheduler.runAfter`) and `convex/crons.ts` are core
(free-tier) features, and the backend runs them in-process. No extra service is needed.

### Version pinning

- The compose file itself says: "Change this to :${REV} if you want to pin to a specific version".
- ghcr tags are **full commit SHAs**: 662 tags, for example
  `ghcr.io/convex/convex-backend:d1fcbeaf939502a23a0f4b7e9095a12e84866294`. Releases on GitHub
  appear as daily "Precompiled YYYY-MM-DD-<sha>" pre-releases
  ([releases](https://github.com/get-convex/convex-backend/releases)).
- Pin backend and dashboard to the **same** SHA, and pin the `convex` npm package to an exact
  version in `package.json`.
- Upgrades go in place via migrations, or by export and import
  ([upgrading.md](https://github.com/get-convex/convex-backend/blob/main/self-hosted/advanced/upgrading.md)).
  This is irrelevant for a reviewer who starts from an empty volume.

## 2. Clerk with Convex auth: keyless or real keys?

### Keyless mode is removed from `@clerk/nextjs`

The `@clerk/nextjs` 7.8.0 changelog (published 2026-08-20; `latest` is 7.9.25) says:

> In development, missing Clerk keys no longer activate keyless mode. When
> `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` and `CLERK_SECRET_KEY` are not set, the SDK now throws an
> error directing you to run `npx clerk@latest init`, which provisions a Clerk application and
> writes the keys to `.env.local`.

Source: [packages/nextjs/CHANGELOG.md](https://github.com/clerk/javascript/blob/main/packages/nextjs/CHANGELOG.md).

The replacement is the Clerk CLI, `clerk` on npm, currently 4.1.0.

- For Next.js, an unauthenticated `clerk init` run "creates an unclaimed development application,
  writes local development keys, and stores a claim breadcrumb for a later `clerk auth login`"
  ([clerk/cli README](https://github.com/clerk/cli)).
- Clerk's blog adds that it "writes the keys without a signup or a login"
  ([blog](https://clerk.com/blog/accountless-setup-clerk-init-nextjs)).
- How long an unclaimed app lives is **not documented**.

### What Convex needs from Clerk

The documented integration follows
[clerk.com/docs … /convex](https://clerk.com/docs/guides/development/integrations/databases/convex)
and [docs.convex.dev/auth/clerk](https://docs.convex.dev/auth/clerk):

1. In the Clerk Dashboard, run **Activate Convex integration**. This adds `aud: "convex"` to the
   session token and reveals the Frontend API URL (dev: `https://verb-noun-00.clerk.accounts.dev`).
2. Run `npx convex env set CLERK_FRONTEND_API_URL <fapi_url>`.
3. Create `convex/auth.config.ts` with
   `providers: [{ domain: process.env.CLERK_FRONTEND_API_URL, applicationID: "convex" }]`.
4. In Next.js, render `<ClerkProvider>` outside `<ConvexProviderWithClerk client useAuth>` (a
   client component), and call `clerkMiddleware()` in `middleware.ts`.

The Convex backend validates tokens by fetching Clerk's OIDC config and JWKS over the internet.
The backend container therefore needs outbound internet access, which is normal for Docker.

### Why accountless doesn't just work

The source is
[`ConvexProviderWithClerk.tsx`](https://github.com/get-convex/convex-backend/blob/main/npm-packages/convex/src/react-clerk/ConvexProviderWithClerk.tsx):

```ts
if (sessionClaims?.aud === "convex") {
  return await getToken({ skipCache }); // Convex integration
} else {
  return await getToken({ template: "convex", skipCache }); // JWT template
}
```

**What breaks**

- An accountless app has neither the integration (`aud` claim) nor a `convex` JWT template. Both
  are dashboard actions on an owned app.
- So `getToken({ template: "convex" })` fails. The provider catches the error and returns `null`,
  and Convex sees the user as unauthenticated.
- The default Clerk v2 session token has `iss`, `sub`, `exp`, `iat`, `nbf`, `azp` and `sid`, but
  **no `aud`** ([session tokens](https://clerk.com/docs/guides/sessions/session-tokens)). That fails
  the OIDC provider's `applicationID: "convex"` check.

**Possible zero-account workaround** **[unverified; needs a spike]**

1. Write a ~10-line `useAuth` adapter. It wraps Clerk's `useAuth` and always calls
   `getToken({ skipCache })` with no template. Pass it to `ConvexProviderWithClerk`.
2. In `auth.config.ts`, use a `customJwt` provider:
   - `issuer: <fapi_url>`
   - `jwks: <fapi_url>/.well-known/jwks.json`
   - `algorithm: "RS256"`
   - **no `applicationID`**

   Convex documents `applicationID` as optional for `customJwt`. It warns that omitting it skips
   `aud` checking and is "often insecure" unless the issuer is specific to your app
   ([custom JWT docs](https://docs.convex.dev/auth/advanced/custom-jwt)). A per-reviewer
   throwaway dev instance is exactly that case.

3. A bootstrap script derives the FAPI URL from the publishable key that `clerk init` wrote. A
   publishable key is `pk_test_` + base64(`<fapi-host>$`). The script then runs
   `npx convex env set CLERK_FRONTEND_API_URL https://<fapi-host>`. That key format is
   **[unverified]**; it is widely relied on but I did not find it in Clerk's official docs.
4. Might `clerk config` or `clerk enable` turn on the Convex integration for an accountless app?
   **[unverified]**. Those commands exist, but the README does not say whether they work before
   the app is claimed.

### Minimal reviewer setup

- **Recommended (documented path), with one Clerk account:**
  1. Sign up at clerk.com (free), create an application, open the **Convex integration** page, and
     click **Activate**.
  2. Paste three values into `.env.local`: `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY`,
     `CLERK_SECRET_KEY` and `CLERK_FRONTEND_API_URL`.
- **Stretch (zero account), if the spike passes:** `npm run setup` runs
  `npx clerk@latest init`, derives the FAPI URL and sets it in Convex. Nothing is pasted.
- **Fallback for either path:** ship the author's own Clerk _development_ instance keys in
  `.env.example`. These are dev-only and revocable. The reviewer needs no Clerk account, at the
  cost of committing a dev `sk_test_` key, which is a hygiene trade-off. This is only acceptable
  if the brief allows it.

## 3. Gotchas

- **Auth config push ordering:** `auth.config.ts` reads `process.env.CLERK_FRONTEND_API_URL` at
  push time. Set it with `npx convex env set` _before_ the first `npx convex dev` that includes
  `auth.config.ts`, or the push fails. A deployment must exist first; for self-hosted it exists as
  soon as the container is up.
- **Two kinds of env:** variables in compose `.env` configure containers. Variables set with
  `npx convex env set` configure Convex functions, such as the n8n webhook URL and the Clerk FAPI
  URL. Use one bootstrap script for both.
- **Data and env survive restarts:** the SQLite DB and the deployment env vars both live in the
  `data` volume. `docker compose down -v` wipes them, and the bootstrap must then run again.
- **Origins vs service names:** `CONVEX_SITE_ORIGIN` is what Convex reports as its HTTP-actions URL
  (`process.env.CONVEX_SITE_URL` inside functions **[unverified mapping]**). It is host-facing
  (`127.0.0.1:3211`). Do not hand that value to n8n; give n8n `http://convex-backend:3211`.
- **`latest` tags drift daily.** Pin by SHA, and pin `convex` npm exactly, so the reviewer gets
  what you tested.
- **Port clashes:** 3210, 3211 and 6791, plus n8n 5678 and Mailpit 1025/8025. The compose file
  exposes `PORT`, `SITE_PROXY_PORT` and `DASHBOARD_PORT` overrides.
- **Clerk `@clerk/nextjs` ≥ 7.8 throws without keys**, so the app cannot even render until keys
  exist. The README must make the Clerk step unmissable, or `npm run dev` should be gated by a
  setup check.
- **Beacon:** self-hosted sends a usage beacon. Set `DISABLE_BEACON=1` for a reviewer stack.

## Recommended compose sketch

```yaml
# docker-compose.yml (sketch; pin SHAs before shipping)
services:
  convex-backend:
    image: ghcr.io/convex/convex-backend:${CONVEX_REV}
    stop_grace_period: 10s
    stop_signal: SIGINT
    ports: ["3210:3210", "3211:3211"]
    volumes: [convex-data:/convex/data]
    environment:
      INSTANCE_NAME: ${CONVEX_INSTANCE_NAME:-lendloop-dev}
      INSTANCE_SECRET: ${CONVEX_INSTANCE_SECRET} # dev-only, pinned in .env.example
      CONVEX_CLOUD_ORIGIN: http://127.0.0.1:3210
      CONVEX_SITE_ORIGIN: http://127.0.0.1:3211
      DISABLE_BEACON: "1"
    healthcheck:
      test: curl -f http://localhost:3210/version
      interval: 5s
      start_period: 10s

  convex-dashboard:
    image: ghcr.io/convex/convex-dashboard:${CONVEX_REV}
    ports: ["6791:6791"]
    environment:
      NEXT_PUBLIC_DEPLOYMENT_URL: http://127.0.0.1:3210
    depends_on:
      convex-backend: { condition: service_healthy }

  n8n:
    image: docker.n8n.io/n8nio/n8n:${N8N_VERSION}
    ports: ["5678:5678"]
    environment:
      DB_TYPE: postgresdb
      DB_POSTGRESDB_HOST: n8n-postgres
      # ... n8n config; webhook calls back to http://convex-backend:3211/<route>
    depends_on: [n8n-postgres]

  n8n-postgres:
    image: postgres:16
    volumes: [n8n-pg:/var/lib/postgresql/data]

  mailpit:
    image: axllent/mailpit:${MAILPIT_VERSION}
    ports: ["8025:8025", "1025:1025"]

volumes:
  convex-data:
  n8n-pg:
```

`.env.example` (committed; dev-only values):

```sh
CONVEX_REV=<pinned sha>
CONVEX_INSTANCE_NAME=lendloop-dev
CONVEX_INSTANCE_SECRET=<pinned 64-hex dev secret>
CONVEX_SELF_HOSTED_URL=http://127.0.0.1:3210
CONVEX_SELF_HOSTED_ADMIN_KEY=<key derived once from the two values above>
NEXT_PUBLIC_CONVEX_URL=http://127.0.0.1:3210
# Clerk (from your Clerk dev app, Convex integration activated)
NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=
CLERK_SECRET_KEY=
CLERK_FRONTEND_API_URL=
```

Convex function env, set by `npm run setup` via `npx convex env set`:
`CLERK_FRONTEND_API_URL`, `N8N_WEBHOOK_URL=http://n8n:5678/webhook/<id>`.

## Reviewer steps

1. `git clone … && cd lendloop && npm ci`
2. `cp .env.example .env.local`. Fill the 3 Clerk values: create a free Clerk dev app and click
   "Activate Convex integration". If the zero-account spike passes, this step becomes
   `npx clerk@latest init`.
3. `docker compose --env-file .env.local up -d`
4. `npm run setup`. This sets the Convex env vars, pushes functions once
   (`npx convex dev --once`), and imports the n8n workflow.
5. `npm run dev`. This runs `next dev` and `convex dev`.

The app, Convex dashboard (admin key from `.env.local`), n8n and Mailpit are then at
`localhost:3000`, `:6791`, `:5678` and `:8025`.

## Open items for a spike

- Run `generate_admin_key.sh` twice with a pinned secret and confirm the key is identical.
- From a Convex action, `fetch("http://n8n:5678/healthz")`, and from n8n, POST to
  `http://convex-backend:3211/<route>`.
- Test accountless `clerk init` + the template-less `useAuth` adapter + a `customJwt` provider, and
  confirm `ctx.auth.getUserIdentity()` returns a user.
- Check whether `npx convex dev` writes `NEXT_PUBLIC_CONVEX_URL` in self-hosted mode.
