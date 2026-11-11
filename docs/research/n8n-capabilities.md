# n8n capabilities for LendLoop: HMAC, retries, error workflow, credential-free export

Research for [#4](https://github.com/rtmkvtn/lendloop-test/issues/4) (map [#1](https://github.com/rtmkvtn/lendloop-test/issues/1)). Researched 2026-11-10.

**Version baseline:** n8n **2.47.3**. It is the GitHub "Latest" release (2026-11-09), and Docker Hub's `n8nio/n8n:stable` has the same digest (`sha256:6723b440…`). A 3.x line exists (3.2.0, pre-release), and it deprecates internal task runners (see §1). Source references below are pinned to the `n8n@2.47.3` tag.

Sources are official docs.n8n.io pages and the n8n source at the `n8n@2.47.3` tag. Context7 was unavailable (it needs auth in this session). Claims marked **[source]** were checked in code. Claims marked **[unverified]** are inferences I did not test.

---

## TL;DR / recommendation

- **Inbound verification (Convex → n8n Webhook):** in the Webhook node, turn on **Raw Body** and set Respond to **"Using 'Respond to Webhook' node"**. Next, a **Crypto node (v2) → Hmac, SHA256, HEX, Binary File = on, property `data`** computes the expected signature over the exact request bytes. The secret comes from a **Crypto credential** (`hmacSecret`). Then a small **Code node** compares the signatures in constant time with `crypto.timingSafeEqual`. It never sees the secret; set `NODE_FUNCTION_ALLOW_BUILTIN=crypto`. Finally an IF node sends a mismatch to **Respond to Webhook 401** and a match to **Respond 202**, followed by the email.
- **Outbound signing (n8n → Convex):** a Code/Set node builds the body **string** once (`JSON.stringify(payload)`). The Crypto node computes the HMAC of that string. The HTTP Request node sends **Body Content Type = Raw** with that same string and the signature header. Do **not** use "Using JSON": the node parses the text into an object and re-serializes it, so the bytes may not match what you signed **[source]**.
- **Secret storage:** use a **Crypto credential**. Do not use `$env`. Exported workflow JSON contains only credential `{id, name}` references. On n8n ≥ 2.0, `$env` is blocked by default (`N8N_BLOCK_ENV_ACCESS_IN_NODE=true`). Unblocking it would expose every env var to every expression. Seed the credential at container start with `n8n import:credentials` from a file rendered from env vars. The command encrypts plaintext `data` itself **[source]**.
- **Failures are never silent:** turn on node **Retry On Fail** for SMTP and HTTP nodes. Retries are capped at 2–5 tries with 0–5000 ms waits **[source]**. Set a workflow-level **Error Workflow** (Error Trigger → email to an admin via Mailpit). It fires once per failed non-manual execution, including webhook-triggered ones, and only after retries are exhausted **[source]**.
- **Bootstrap:** pin `docker.n8n.io/n8nio/n8n:2.47.3`. Set a fixed `N8N_ENCRYPTION_KEY`. At startup run `import:credentials`, then `import:workflow --separate`, then `publish:workflow --id=…` for each trigger workflow, then `n8n start`. Imports **unpublish** workflows by default.

---

## 1. Webhook: raw body, HMAC-SHA256, constant-time compare, 401

**Raw body.** The Webhook node option **Raw Body** "Specify that the Webhook node will receive data in a raw format, such as JSON or XML" ([Webhook docs](https://docs.n8n.io/integrations/builtin/core-nodes/n8n-nodes-base.webhook/)). In code, the node still emits the parsed `json.body`, plus `binary.data` holding the exact request bytes as base64. The MIME type is the request `Content-Type` ([Webhook.node.ts L335-354](https://github.com/n8n-io/n8n/blob/n8n@2.47.3/packages/nodes-base/nodes/Webhook/Webhook.node.ts#L335-L354)) **[source]**. Never compute an HMAC over `json.body` re-stringified. Use `binary.data`.

The payload limit is 16 MB by default (`N8N_PAYLOAD_SIZE_MAX`) ([Webhook docs](https://docs.n8n.io/integrations/builtin/core-nodes/n8n-nodes-base.webhook/)).

**Crypto node (recommended for the HMAC itself).**

- Actions: Decrypt, Encrypt, Generate, Hash, **Hmac**, Sign. Hmac supports MD5, SHA256, SHA3-*, SHA384 and SHA512, with HEX or BASE64 encoding. A **Binary File** toggle with a binary property name makes it hash a binary field ([Crypto docs](https://docs.n8n.io/integrations/builtin/core-nodes/n8n-nodes-base.crypto/)).
- With Binary File on, v2 calls `createHmac(type, hmacSecret).update(Buffer.from(binaryData.data, base64))`. It streams instead when the binary is stored by id (filesystem mode). Either way it hashes the exact raw bytes ([CryptoV2.node.ts ~L691-710](https://github.com/n8n-io/n8n/blob/n8n@2.47.3/packages/nodes-base/nodes/Crypto/v2/CryptoV2.node.ts)) **[source]**.
- **Version pitfall:** **Crypto v2** (default version 2, added in [#24798](https://github.com/n8n-io/n8n/pull/24798), Jan 2026) reads the secret from the **Crypto credential** field `hmacSecret`. **Crypto v1** took the secret as a plain node parameter `secret`, which means it ends up **in the exported workflow JSON** ([CryptoV1.node.ts L276](https://github.com/n8n-io/n8n/blob/n8n@2.47.3/packages/nodes-base/nodes/Crypto/v1/CryptoV1.node.ts#L276)) **[source]**. Make sure the exported nodes have `"typeVersion": 2`.
- Credential type name `crypto`, fields `hmacSecret`, `signPrivateKey`, `encryptionPassphrase`, … ([Crypto.credentials.ts](https://github.com/n8n-io/n8n/blob/n8n@2.47.3/packages/nodes-base/credentials/Crypto.credentials.ts); [Crypto credential docs](https://docs.n8n.io/integrations/builtin/credentials/crypto/)).

**Code node and `crypto`.**

- On 2.x, the JS Code node runs in a task runner. `require()` of built-ins is denied unless `NODE_FUNCTION_ALLOW_BUILTIN` lists them. The default is empty; `*` allows all ([task-runner env vars](https://docs.n8n.io/deploy/host-n8n/configure-n8n/basic-configuration/use-environment-variables/task-runners.md); [js-runner-config.ts](https://github.com/n8n-io/n8n/blob/n8n@2.47.3/packages/@n8n/task-runner/src/config/js-runner-config.ts)) **[source]**. So `require('crypto')` needs `NODE_FUNCTION_ALLOW_BUILTIN=crypto`.
- Runner mode: `N8N_RUNNERS_MODE` defaults to `internal`, a child process of n8n that inherits its env. Internal mode is **deprecated** (logs a warning, and is slated for 3.0). Docs recommend `external` mode (an `n8nio/runners` sidecar at the same version) for production. In external mode, `NODE_FUNCTION_ALLOW_*` must be set as `env-overrides` in `/etc/n8n-task-runners.json`, not as container env ([Set up task runners](https://docs.n8n.io/deploy/host-n8n/configure-n8n/set-up-task-runners.md)). For a take-home, internal mode plus the env var is fine. Mention the trade-off in the README.
- A Code node **cannot read credentials**. If it computed the HMAC itself, the secret would have to come from `$env`, which is the reason to split the work: Crypto node for the HMAC, Code node only for the comparison.

**Constant-time compare.** No built-in node does a timing-safe compare; an IF node's string equality is not constant-time **[unverified, by design of the node]**. Use a Code node, which needs no secret:

```js
const crypto = require("crypto");
const expected = Buffer.from($json.expectedSig, "hex");
const received = Buffer.from(
  String($("Webhook").item.json.headers["x-lendloop-signature"] ?? ""),
  "hex",
);
return [
  {
    json: {
      valid:
        expected.length === received.length &&
        crypto.timingSafeEqual(expected, received),
    },
  },
];
```

Header names arrive lower-cased (Node/Express behaviour) **[unverified in n8n docs]**.

**Responding 401.** Set the Webhook's Respond to **"Using 'Respond to Webhook' Node"**. The Respond to Webhook node has a **Response Code** option. If the workflow errors before any Respond node runs, the caller gets **500**. If the workflow finishes without reaching one, the caller gets 200. Only the first Respond node that executes takes effect ([Respond to Webhook docs](https://docs.n8n.io/integrations/builtin/core-nodes/n8n-nodes-base.respondtowebhook/)). Suggested flow: verify, then IF. The false branch goes to Respond 401 (and optionally Stop And Error, if rejected signatures should also alert). The true branch goes to Respond 202, then the email. Responding before the email decouples Convex's retry from SMTP. The email gets its own retries and the error workflow.

**Replay protection.** The Crypto-binary approach signs the raw body only, so put `eventId` and `sentAt` **inside** the signed JSON body. After verification, check freshness and dedupe on `eventId`. Signing `"${ts}.${body}"` with the timestamp in a header would need the raw body as a string inside an expression or Code node. That is awkward when binary data is stored on the filesystem.

Optionally, add the Webhook node's built-in **Header Auth** (Basic, Header, JWT and None are available) as a static second factor ([Webhook docs](https://docs.n8n.io/integrations/builtin/core-nodes/n8n-nodes-base.webhook/)).

## 2. Signing outbound HTTP Request bodies

- HTTP Request "Send Body → **JSON / Using JSON**" runs the JSON text through `parseJsonParameter` into an object. With `json: true`, the client then re-serializes it. "**Raw**" sends the `body` string as-is with your chosen `content-type` ([HttpRequestV3.node.ts L447-458, L498-499, L544-562](https://github.com/n8n-io/n8n/blob/n8n@2.47.3/packages/nodes-base/nodes/HttpRequest/V3/HttpRequestV3.node.ts#L447-L562)) **[source]**.
- **Pitfall:** if you HMAC a JSON object, or a string you then paste into "Using JSON", key order, whitespace and number formatting can change between the signed text and the bytes on the wire. Convex then verifies against different bytes. **Rule: serialize once, sign that string, and send that same string as a Raw body.**
- Pattern: Set/Code builds `bodyStr = JSON.stringify({...})`. Crypto (Hmac, SHA256, HEX, Binary off, Value `{{$json.bodyStr}}`, Property `sig`) adds the signature. HTTP Request then uses Method POST, Body Content Type Raw, Content-Type `application/json`, Body `{{$json.bodyStr}}`, and header `X-LendLoop-Signature: {{$json.sig}}`.
- For the GET that fetches overdue loans (no body), sign a canonical string such as `"${method}\n${path}\n${timestamp}"`, and send the timestamp in a header too. The Convex side must rebuild it identically. That convention belongs to the Convex HTTP-endpoint ticket.
- The idempotent write-back body should carry an idempotency key, for example `loanId + reminderDate`, so Convex can dedupe retries.

## 3. Retries, On Error, Error Workflow

**Retry On Fail** (node Settings). The engine clamps **Max Tries to 2–5** (default 3) and **Wait Between Tries to 0–5000 ms** (default 1000). Values outside these ranges are silently clamped ([workflow-execute.ts `getRetryParams` L1860-1871](https://github.com/n8n-io/n8n/blob/n8n@2.47.3/packages/core/src/execution-engine/workflow-execute.ts#L1860-L1871)) **[source]**. There is no exponential backoff.

- **Retries re-run the whole node with all its input items** (`runNode(executionData)` inside the try loop, L2397-2445) **[source]**. If a Send Email node fails on item 7 of 10, a retry re-sends items 1–6. **Mitigation:** process borrowers one at a time (Loop Over Items with batch size 1, or a per-borrower sub-workflow), and keep the Convex write-back idempotent.
- A third-party report says retries were ignored when combined with an On Error "Continue" mode, in v1.35 ([n8n#9236](https://github.com/n8n-io/n8n/issues/9236)). Current code shows the retry loop is independent of `onError`, but I did not test the combination **[unverified]**.

**On Error** values: `stopWorkflow` (default), `continueRegularOutput`, `continueErrorOutput` ([workflow-execute.ts L1061-1065](https://github.com/n8n-io/n8n/blob/n8n@2.47.3/packages/core/src/execution-engine/workflow-execute.ts#L1061-L1065)). With either Continue mode, the execution **succeeds**, so the **Error Workflow does not fire**. To log per-borrower failures without staying silent: route the error output to "write status=failed to Convex", then end with an IF on "any failures?" leading to **Stop And Error**, which forces the execution to fail and triggers the error workflow ([error handling docs](https://docs.n8n.io/build/flow-logic/handle-errors-gracefully.md)).

**Error Workflow and Error Trigger.**

- Set it per workflow under Workflow Settings → Error workflow. It "runs if an execution fails". The error workflow must start with an Error Trigger. One error workflow can serve many workflows, and it **does not need to be published** ([Error Trigger docs](https://docs.n8n.io/integrations/builtin/core-nodes/n8n-nodes-base.errortrigger/)).
- **Manual (editor) runs never trigger it**: "The Error Trigger only runs when an automatic workflow errors" (same page). The code checks `!isManualMode && status !== 'success' && status !== 'waiting'` ([execution-lifecycle-hooks.ts L839-846](https://github.com/n8n-io/n8n/blob/n8n@2.47.3/packages/cli/src/execution-lifecycle/execution-lifecycle-hooks.ts#L839-L846)) **[source]**. **Webhook-** and **schedule-**triggered production runs do trigger it. Test the error path through the production webhook URL or a published schedule, not the "Execute workflow" button.
- **Fires once, after the final retry**: retries happen inside the node's loop within the same execution. The execution fails only after the last try, and the hook then runs the error workflow once **[source]**. `execution.retryOf` refers to a _manual re-run of a failed execution_, not to node retries.
- The payload is `execution{id,url,error{message,stack},lastNodeExecuted,mode,retryOf}` plus `workflow{id,name}`. If the trigger node itself failed, you get `trigger{error,mode}` instead of `execution` ([Error Trigger docs](https://docs.n8n.io/integrations/builtin/core-nodes/n8n-nodes-base.errortrigger/); [execute-error-workflow.ts](https://github.com/n8n-io/n8n/blob/n8n@2.47.3/packages/cli/src/execution-lifecycle/execute-error-workflow.ts)). `id` and `url` require the execution to be saved.
- An error workflow that fails on itself does not loop (guard in execute-error-workflow.ts). If the error workflow's own SMTP send fails, that failure _is_ silent apart from the execution log, so keep that workflow trivial.
- In exported JSON the setting is stored as `settings.errorWorkflow: "<workflowId>"`. Use fixed workflow ids in the committed JSON so the reference survives import. Import keeps ids and overwrites by id ([CLI docs](https://docs.n8n.io/hosting/cli-commands/)).

## 4. Schedule Trigger (daily)

- Trigger Interval **Days**, Days Between Triggers `1`, Trigger at Hour and Minute. Or **Custom (Cron)**, e.g. `0 6 * * *` ([Schedule Trigger docs](https://docs.n8n.io/integrations/builtin/core-nodes/n8n-nodes-base.scheduletrigger/)).
- Timezone: the workflow's timezone setting if set, otherwise the instance timezone, **`GENERIC_TIMEZONE`** (default `America/New_York`, "Important for schedule nodes") ([timezone env vars](https://docs.n8n.io/deploy/host-n8n/configure-n8n/basic-configuration/use-environment-variables/timezone-and-localization.md)). Set `GENERIC_TIMEZONE` (and `TZ` for container logs, by convention **[unverified in docs]**) in compose.
- The workflow must be **saved and published** to run on schedule. 2.0 renamed Activate/Deactivate to Publish/Unpublish ([2.0 breaking changes](https://docs.n8n.io/changelog/v20-breaking-changes.md)).
- For demoability, also expose a manual path (e.g. a protected Webhook trigger in the same workflow, or `n8n execute --id`). A reviewer should not have to wait a day. Note that `n8n execute` and editor runs are manual-ish, and editor runs will not fire the error workflow.

## 5. Export and secrets

- "Exported workflow JSON files include credential **names and IDs**." Names may be sensitive; IDs are not. HTTP Request nodes imported from cURL may carry inline auth headers ([export/import docs](https://docs.n8n.io/workflows/export-import/)). Nodes reference credentials as `"credentials": {"crypto": {"id": "...", "name": "..."}}`. The secret lives encrypted in the DB, keyed by `N8N_ENCRYPTION_KEY`. Secrets leak into workflow JSON only when they are typed into node parameters, for example Crypto **v1** `secret`, a hard-coded header value, or a Code node constant.
- **`$env`:** from n8n 2.0, "The default value for `N8N_BLOCK_ENV_ACCESS_IN_NODE` is now set to `true`" ([2.0 breaking changes](https://docs.n8n.io/changelog/v20-breaking-changes.md)). The older [security env-vars page](https://docs.n8n.io/hosting/configuration/environment-variables/security/) still shows `false`, which is stale. Setting it to `false` lets _every_ expression and Code node read _every_ env var, including `N8N_ENCRYPTION_KEY` and DB passwords.
- **Credential overwrites** (`CREDENTIALS_OVERWRITE_DATA='{"crypto":{"hmacSecret":"…"}}'`) can inject the secret into all credentials of a type from env, and n8n hides the overwritten fields. The docs say the env method is not recommended ("Environment variables aren't protected in n8n, so the data can leak to users"). Overwrites are in-memory unless persistence is on ([credential overwrites](https://docs.n8n.io/administer/manage-credentials/credential-overwrites.md)). Whether they apply to non-OAuth types like `crypto` is not stated **[unverified]**.
- **Recommendation:** keep the secret in a **Crypto credential**, seeded at startup by `import:credentials` from a JSON file rendered from the compose env (`LENDLOOP_HMAC_SECRET`). Commit only a template, for example `credentials.template.json` with `"data": {"hmacSecret": "${LENDLOOP_HMAC_SECRET}"}`, rendered by `envsubst` or `sh` into a tmpfs path. `import:credentials` accepts plaintext `data` objects and encrypts them (`isCredentialData` → `cipher.encryptV2`, [import/credentials.ts L464-470](https://github.com/n8n-io/n8n/blob/n8n@2.47.3/packages/cli/src/commands/import/credentials.ts#L464-L470)) **[source]**. Give the credential a fixed `id` that matches the reference in the workflow JSON. Use the same pattern for the SMTP credential (Mailpit) if needed.

## 6. Import at container start, image pinning

CLI ([CLI commands](https://docs.n8n.io/hosting/cli-commands/)):

- `n8n import:credentials --input=file.json` or `--separate --input=dir/`. `n8n import:workflow --separate --input=dir/`. `--userId` and `--projectId` are mutually exclusive.
- Same ids are **overwritten**. "By default, `import:workflow` **deactivates** every imported workflow", and `--activeState=fromJson` works only in multi-main or queue mode.
- Publish afterwards: `n8n publish:workflow --id=<ID>`, one per id; `--all` is not supported. `update:workflow --active` is deprecated since 2.0. With the publication service on (the default), a running instance picks up changes within about 15 s, and changes made while n8n is stopped apply at startup.
- Docker: `docker exec -u node -it <container> n8n …`.

`N8N_ENCRYPTION_KEY`: n8n generates a random key on first launch and stores it in `~/.n8n` (`/home/node/.n8n` in the image). Setting the env var makes n8n use your key ([custom encryption key](https://docs.n8n.io/deploy/host-n8n/configure-n8n/basic-configuration/configuration-examples/set-a-custom-encryption-key.md)). Set it explicitly in `.env`, so re-imports and volume resets stay consistent.

Owner bootstrap (≥ 2.17.0): `N8N_INSTANCE_OWNER_MANAGED_BY_ENV=true` with `N8N_INSTANCE_OWNER_EMAIL`, `_FIRST_NAME`, `_LAST_NAME`, `_PASSWORD_HASH` (bcrypt) pre-creates the login, so a reviewer can open the editor without a setup wizard ([manage settings via env](https://docs.n8n.io/deploy/host-n8n/configure-n8n/manage-settings-using-environment-variables.md)).

Sketch (compose; **[unverified]**, not executed):

```yaml
n8n:
  image: docker.n8n.io/n8nio/n8n:2.47.3
  environment:
    N8N_ENCRYPTION_KEY: ${N8N_ENCRYPTION_KEY}
    GENERIC_TIMEZONE: Europe/Berlin
    TZ: Europe/Berlin
    NODE_FUNCTION_ALLOW_BUILTIN: crypto
    LENDLOOP_HMAC_SECRET: ${LENDLOOP_HMAC_SECRET}
    WEBHOOK_URL: ${N8N_PUBLIC_URL}
  volumes:
    - n8n_data:/home/node/.n8n
    - ./n8n/workflows:/import/workflows:ro
    - ./n8n/credentials.template.json:/import/credentials.template.json:ro
  entrypoint: ["/bin/sh", "-c"]
  command:
    - |
      set -e
      sed "s|\$${LENDLOOP_HMAC_SECRET}|$$LENDLOOP_HMAC_SECRET|" /import/credentials.template.json > /tmp/creds.json
      n8n import:credentials --input=/tmp/creds.json && rm /tmp/creds.json
      n8n import:workflow --separate --input=/import/workflows
      n8n publish:workflow --id=lendloopRequestNotify
      n8n publish:workflow --id=lendloopOverdueDaily
      exec n8n start
```

`envsubst` may not be present in the image **[unverified]**, hence `sed`. Overriding the entrypoint skips the image's default entrypoint script. Check that it does not do required setup (e.g. custom certificates) **[unverified]**.

---

## Open risks / questions for the map

1. **Reachability (Convex → n8n):** if Convex runs as a **cloud** deployment, it cannot call a webhook on a laptop's docker-compose `localhost`. The options are a self-hosted Convex backend in the same compose, a tunnel, or deploying n8n publicly (e.g. the myDO droplet behind Traefik). The overdue flow (n8n → Convex) works either way. This needs a decision on the map.
2. **Retry granularity:** node retries re-run all items, so per-borrower isolation (loop or sub-workflow) plus Convex-side idempotency are required to avoid duplicate reminder emails.
3. **Signature convention** (header names, hex vs base64, what is signed for GET, timestamp/replay window) must be one shared spec for Convex and n8n. Propose: hex HMAC-SHA256 over raw body bytes; `eventId` and `sentAt` inside the body; 5-minute window.
4. **Task runner mode:** internal mode is deprecated (removed or defaulting differently in 3.x). Pinning 2.47.3 avoids churn. Note it in the README.
5. **Error workflow testability:** it cannot be triggered from the editor's manual run, so the demo or test plan should hit the production webhook with a bad SMTP config, or use Stop And Error.
