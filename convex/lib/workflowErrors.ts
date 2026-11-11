import type { MutationCtx } from "../_generated/server";
import { sanitiseError } from "./automationFields";
import { parseHttpUrl } from "./n8nClient";

export const WORKFLOW_EVENTS = {
  executionFailed: "n8n.execution_failed",
  missedRun: "reminders.missed_run",
  triggerFailed: "reminders.trigger_failed",
} as const;

export type WorkflowEvent =
  (typeof WORKFLOW_EVENTS)[keyof typeof WORKFLOW_EVENTS];

const MAX_NAME = 120;

const shortText = (value: string | undefined) =>
  value?.trim().slice(0, MAX_NAME) || undefined;

export async function recordWorkflowError(
  ctx: MutationCtx,
  row: {
    idempotencyKey: string;
    event: WorkflowEvent;
    error: string;
    workflowName?: string;
    failedNode?: string;
    executionUrl?: string;
  },
) {
  const existing = await ctx.db
    .query("automationEvents")
    .withIndex("by_idempotency_key", (q) =>
      q.eq("idempotencyKey", row.idempotencyKey),
    )
    .first();
  if (existing) return "duplicate" as const;
  await ctx.db.insert("automationEvents", {
    kind: "workflow_error",
    event: row.event,
    idempotencyKey: row.idempotencyKey,
    status: "failed",
    attempts: 1,
    lastError: sanitiseError(row.error) || "Unknown error",
    workflowName: shortText(row.workflowName),
    failedNode: shortText(row.failedNode),
    // Rendered as a link on the Admin page, so only http(s) gets through.
    executionUrl: parseHttpUrl(row.executionUrl)?.href,
    updatedAt: Date.now(),
  });
  return "inserted" as const;
}
