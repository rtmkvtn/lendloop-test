# Spike: self-hosted Convex in compose

Ticket: rtmkvtn/lendloop-test#13 (map #1). Run on 2026-11-10 on macOS (Apple Silicon), Docker
Desktop engine 28.2.2. This spike builds on `research/convex-clerk-compose.md` (branch
`research/convex-clerk-compose`) and `research/n8n-capabilities.md` (branch
`research/n8n-capabilities`). All secrets used were dev-only dummies.

Reference files on this branch: `spike/convex-compose/docker-compose.yml` and the throwaway
Convex project in `spike/convex-compose/app/` (`convex/ping.ts`, `http.ts`, `crons.ts`,
`schema.ts`).

## Results

| #   | Check                                                                                      | Result                                                                                                                                                                        |
| --- | ------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | A Convex action's `fetch("http://n8n:5678/healthz")` reaches n8n by compose service name   | **PASS**                                                                                                                                                                      |
| 2   | From inside the n8n container, `http://convex-backend:3211/<route>` reaches an HTTP action | **PASS**                                                                                                                                                                      |
| 3   | Pinned `INSTANCE_NAME` + `INSTANCE_SECRET` give a stable admin key across `down -v && up`  | **PASS, with a caveat**: the key _string_ differs on every run, but any key generated from the pinned pair stays valid                                                        |
| 4   | `npx convex dev --once` writes the client URL to `.env.local` in self-hosted mode          | **PASS**: it writes `NEXT_PUBLIC_CONVEX_URL` and `NEXT_PUBLIC_CONVEX_SITE_URL` when `next` is in `package.json`. Without `next`, it writes `CONVEX_URL` and `CONVEX_SITE_URL` |
| 5   | Crons register and run                                                                     | **PASS**                                                                                                                                                                      |

## Versions pinned

- `ghcr.io/convex/convex-backend:d1fcbeaf939502a23a0f4b7e9095a12e84866294`
  (digest `sha256:e9c084e8bd6c1f249012c672193f0988c748824f55a24cdad45f6185a8462f9a`, built
  2026-10-28, ~584 MB). This was `:latest` on the spike date. The image label
  `org.opencontainers.image.revision` gives the SHA.
- `ghcr.io/convex/convex-dashboard:d1fcbeaf939502a23a0f4b7e9095a12e84866294`
  (digest `sha256:caf95d3f2241cddc103a84b728294fa0777c6acc291a2c4612c1d06faaa1c43a`, ~487 MB).
- `docker.n8n.io/n8nio/n8n:2.47.3`
  (digest `sha256:6723b440354bb8e1395a1ecee12685fe03923f897bf6e4d5bb2c6c2bd2051697`, ~1.16 GB).
- npm `convex@1.49.0` (exact). It needs **Node >= 22**.

## Details and exact commands

Commands below run from `spike/convex-compose/` (compose) or `spike/convex-compose/app/` (CLI).
The CLI was invoked as `node node_modules/convex/bin/main.js …` under Node 22.23.4. That is the
same thing `npx convex …` runs.

### Setup

```sh
docker compose up -d --wait
cd app && npm init -y && npm i convex@1.49.0 --save-exact
docker compose exec convex-backend ./generate_admin_key.sh
# .env.local: CONVEX_SELF_HOSTED_URL='http://127.0.0.1:3210', CONVEX_SELF_HOSTED_ADMIN_KEY='<key>'
npx convex dev --once --typecheck disable
```

### (1) Convex → n8n

```sh
npx convex run ping:callN8n
# {"target":"http://n8n:5678/healthz","status":200,"body":"{\"status\":\"ok\"}"}
```

The stock image does not screen fetches for SSRF, so the action reached the compose DNS name
directly. No extra config was needed.

### (2) n8n → Convex HTTP action

```sh
docker compose exec n8n wget -qO- --header='content-type: application/json' \
  --post-data='{"from":"n8n"}' http://convex-backend:3211/n8n-callback
# {"ok":true,"echoed":"{\"from\":\"n8n\"}"}
docker compose exec n8n node -e 'fetch("http://convex-backend:3211/n8n-callback",{method:"POST",body:"node-fetch"}).then(r=>r.text()).then(console.log)'
# {"ok":true,"echoed":"node-fetch"}
```

`CONVEX_SITE_ORIGIN=http://127.0.0.1:3211` (the host-facing value) did not interfere with this.
The same route also answered from the host at `http://127.0.0.1:3211/n8n-callback`. `wget` (BusyBox)
and `node` are both present in the n8n 2.47.3 image.

### (3) Admin key stability

`generate_admin_key.sh` printed a **different string each time**, even with the same pinned
secret:

```
lendloop-dev|01737455d52fc1ec90e62729fa973ec18b9f8933c1480edb5ff870783dc1577fd8e224d8cf   (run 1)
lendloop-dev|014ae205a10cd1194fe727a533b7481097a499a6e9d6c771698d8ab3960c9fe653ba867d0e   (run 2, same container)
lendloop-dev|0128e2ab54a3a23b65e5bbfa9fafb11b6913686e573730e2c4e564bb93c816fcd4db83e01e   (after down -v && up)
```

The key is encrypted with a random nonce, so string comparison is the wrong test. The test that
matters is validity:

- The run-1 key, generated before `docker compose down -v`, authenticated after `down -v && up`
  (`npx convex env list` → "No environment variables set"). After a second full
  `down -v && up`, `npx convex dev --once` and `npx convex run ping:callN8n` both worked with
  the same run-1 key.
- Control: a made-up key (`lendloop-dev|01deadbeef00`) was rejected with "The provided admin key
  was invalid for this instance".
- Control: I restarted the backend on the same volume with
  `INSTANCE_SECRET=…0002`, while the volume's persisted `credentials/instance_secret` still held
  `…0001`. The run-1 key was then rejected. So the env var takes precedence over the persisted
  file, and the key is bound to the secret.

**Consequence:** generate one key once, commit it to `.env.example` next to the pinned
`INSTANCE_NAME` and `INSTANCE_SECRET`, and it stays valid for every reviewer. Don't add an
"is the key identical?" assertion to any setup script, because it will always fail.

### (4) What `convex dev --once` writes to `.env.local`

`.env.local` held only `CONVEX_SELF_HOSTED_URL` and `CONVEX_SELF_HOSTED_ADMIN_KEY` before each run.

- With no `next` in `package.json`: "Saved CONVEX_URL and CONVEX_SITE_URL to .env.local", with
  values `http://127.0.0.1:3210` and `http://127.0.0.1:3211`.
- With `"next"` declared in `dependencies` (only declared, not installed): "Saved
  NEXT_PUBLIC_CONVEX_URL and NEXT_PUBLIC_CONVEX_SITE_URL to .env.local", with the same values.

The values come from the backend's `CONVEX_CLOUD_ORIGIN` and `CONVEX_SITE_ORIGIN`. Detection uses
the framework in `package.json`. Shipping `NEXT_PUBLIC_CONVEX_URL` in `.env.example` is still
harmless and makes `next dev` work before the first `convex dev`.

### (5) Crons

`convex/crons.ts` defines `crons.interval("spike tick", { seconds: 10 }, internal.ping.tick, {})`.

- Backend log on deploy: `model::cron_jobs: Crons Added: [CronIdentifier("spike tick")]`.
- `npx convex run ping:ticks` returned count 6, and 25 s later count 9 (about one tick every
  10 s).
- `_cron_jobs` is not readable through `npx convex data`, which reports "no documents". Check the
  logs, the dashboard, or a side effect instead.

The dashboard at `:6791` returned 200. n8n `/healthz` on the host returned 200.

## Gotchas

1. **`convex@1.49.0` refuses Node < 22** ("Your Node version 20.19.6 is too old. Convex requires
   at least Node v22.0"). Put `"engines": {"node": ">=22"}` and an `.nvmrc` in the real repo, and
   list Node 22 in the reviewer prerequisites.
2. **Admin key strings are non-deterministic** (see (3)). Treat the key as "generate once, commit
   once".
3. **Docker Desktop port race after `down -v && up`.** Once, the recreated backend came up
   healthy but with **no host port mapping** (`3210-3211/tcp` and no `0.0.0.0:` prefix). Host
   requests got "Empty reply from server" and the CLI looped on "WebSocket … socket hang up".
   `docker compose up -d --force-recreate convex-backend` fixed it. A setup script should check
   `curl -sf http://127.0.0.1:3210/version` from the **host** before running `convex dev`. The
   in-container healthcheck does not catch this.
4. A bad or wrong-secret admin key does not fail fast. The CLI prints "Failed to authenticate"
   and keeps reconnecting before it errors. A stale key can look like a hang.
5. The pinned tag is just the SHA, so `CONVEX_REV` must be the full 40-character commit, and
   only commits with a published image work. For example,
   `930598113e0dd6fe6d7e5d184675a3ba378bc5f3` (the 2026-11-09 "Precompiled" release) has **no**
   ghcr image ("manifest unknown"). To pick a pin, take the `org.opencontainers.image.revision`
   label from `:latest`, not the GitHub release list.
6. `--typecheck disable` was used only because this throwaway project has no TypeScript
   installed. The real project should install `typescript` and keep type checking on.
7. Backend logs `WARN Module not in functions: convex.config.js` on deploy. It is harmless
   (there are no components).

## Effect on the contracts

- The Convex → n8n contract holds as researched: actions call `http://n8n:5678/…` by service name,
  and n8n calls back to `http://convex-backend:3211/<route>`. The host-facing origins stay at
  `127.0.0.1`.
- The fully-local decision holds. Everything ran from pinned images plus `npm i`, with no cloud
  account. The real repo needs only the Node 22 requirement and a host-side readiness check.
