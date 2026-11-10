# Self-hosted Convex in docker-compose for local development

A reviewer has to run the whole system (app, backend, automations, email) from the repository alone, and the backend must reach n8n and be reached by it. So the Convex backend and dashboard run in docker-compose next to n8n, Postgres and Mailpit, on SQLite storage, rather than on a Convex Cloud dev deployment. Both images are pinned to the same commit SHA (the `org.opencontainers.image.revision` label, because not every commit has an image), and `INSTANCE_NAME`/`INSTANCE_SECRET` are pinned so the committed dev admin key in `.env.example` keeps working after `docker compose down -v`.

## Considered Options

- **Convex Cloud dev deployment.** The reviewer would need a Convex account on top of Clerk, and a cloud deployment can't call `http://n8n:5678` on the reviewer's machine without a tunnel.
- **Self-hosted Convex in compose (chosen).** One `docker compose up -d`; services call each other by name (`http://n8n:5678`, `http://convex-backend:3211`). The stock image passes no HTTP proxy, so action `fetch()` can reach compose services.

## Consequences

- The dev admin key, instance secret and every other non-Clerk value in `.env.example` are public dev defaults. Production must use Convex Cloud or a self-hosted backend on Postgres with its own secrets (README, "Running it in production").
- `npm run setup` checks readiness from the host (`/version`), because a healthy container can still have unmapped ports.
- Function env vars (Clerk issuer, n8n URLs, secrets) are set with `npx convex env set`, not through compose `environment:`. `CLERK_FRONTEND_API_URL` must be set before the first push, because `auth.config.ts` reads it.
- `convex@1.49.0` needs Node 22, pinned through `.nvmrc` and `engines`.
