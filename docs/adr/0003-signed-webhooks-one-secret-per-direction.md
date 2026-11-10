# Signed webhooks with one secret per direction

Every call between Convex and n8n carries `X-LendLoop-Timestamp` (unix seconds) and `X-LendLoop-Signature: v1=<hex>`, where `hex = HMAC-SHA256(secret, "<timestamp>.<METHOD>.<path>.<rawBody>")`. The receiver answers 401 if the timestamp is more than 300 s off or the signature doesn't match in a constant-time comparison. Calls from Convex to n8n are signed with `CONVEX_TO_N8N_SECRET` and calls from n8n to Convex with `N8N_TO_CONVEX_SECRET`, so a leaked secret on one side can't forge calls in the other direction. Method and path are in the signed string, so a signature for one endpoint can't be replayed against another, and the one format also covers signed GETs, whose body is empty.

## Considered Options

- **A shared bearer token or one shared secret.** Simpler, but a token proves nothing about the body, and one shared secret lets either side impersonate the other.
- **HMAC over the body only (the common webhook pattern).** It doesn't bind method or path, and it can't sign the body-less `GET /automation/overdue-loans`.
- **Mutual TLS or private networking alone.** It's the right extra layer in production (README, "Running it in production"), but it doesn't run in a one-command local stack, and it doesn't protect each payload.

## Consequences

- Replays inside the 300 s window are accepted, so every receiver is idempotent: Notifications by `deliveryId` (n8n) and `eventId` (Convex), Reminders by `reminderKey`, workflow errors by n8n execution id.
- n8n verifies over the webhook's raw body with a Crypto node whose secret lives in an n8n Crypto credential, because workflows can't read env (`$env` stays blocked). Convex must send the exact bytes it signed.
- The `v1=` prefix allows rotation: a receiver can accept `v1` and `v2` during a changeover.
- Changing the scheme means changing `convex/lib/signature.ts`, the signing and verifying nodes in all three n8n workflows, and the tests that pin it.
