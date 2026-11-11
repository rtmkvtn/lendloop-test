# Roles in a Convex `users` table, not Clerk metadata

Clerk only proves who the caller is. A Member's role (`user` or `admin`) and the Trusted Lender flag live on their Convex `users` row, keyed by the token's `tokenIdentifier`, and every public function is built from wrappers (`convex/lib/functions.ts`) that load that row and reject callers without it, or without `role: "admin"` for Admin functions. The row is created on first sign-in as a plain Member. Admin is granted only by the internal `users.promote` function, which `npm run promote` runs with the deployment admin key. No client path can grant it, so the access rules, the audit log and the data they protect sit in one transactional store.

## Considered Options

- **Roles in Clerk `publicMetadata`, carried as a session-token claim.** A role change only takes effect when the token is refreshed, the rule would be split between two systems, and anyone with Clerk dashboard access becomes an Admin-maker outside the audit log.
- **Clerk Organizations and roles.** Built for multi-tenant B2B, which a single neighbourhood board doesn't need, and it carries the same split and staleness.
- **A Convex `users` row (chosen).** A role change is visible in the same transaction, and tests can drive it through `convex-test` without Clerk.

## Consequences

- The `users` row also stores `email` and `name`, copied from the session token on each sign-in, because Notifications and Reminders are addressed from Convex. That's why the Clerk checklist adds the `email`, `name` and `given_name` claims.
- Admins get no bypass in Member functions. Admin powers exist only in `admin.*`.
- Deleting a Clerk user doesn't touch Convex on its own. Production needs Clerk's `user.deleted` webhook to anonymise the row (README, "Running it in production").
