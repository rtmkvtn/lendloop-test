import { internal } from "../_generated/api";
import type { Doc } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";
import { type AutomationStatus, STUCK_AFTER_MS } from "./automationFields";
import { todayInAppTimeZone } from "./dates";
import { fail } from "./errors";
import { isOverdue } from "./overdue";

type Event = Doc<"automationEvents">;
type RetryPatch = Pick<
  Event,
  "status" | "retryGeneration" | "lastError" | "updatedAt"
>;

type KindPolicy = {
  waitsAs: readonly AutomationStatus[];
  retry: (ctx: MutationCtx, event: Event, patch: RetryPatch) => Promise<void>;
};

// Workflow errors have no policy: they can't be retried and never wait on n8n.
export const KIND_POLICY = {
  notification: {
    waitsAs: ["accepted"],
    async retry(ctx, event, patch) {
      await ctx.db.patch("automationEvents", event._id, {
        ...patch,
        attempts: 0,
      });
      await ctx.scheduler.runAfter(0, internal.notifications.deliver, {
        eventId: event._id,
      });
    },
  },
  // Reminders have no Convex-side delivery, so a retried one waits as pending
  // for n8n's write-back.
  reminder: {
    waitsAs: ["accepted", "pending"],
    async retry(ctx, event, patch) {
      const loan = event.requestId
        ? await ctx.db.get("requests", event.requestId)
        : null;
      if (!loan || !isOverdue(loan, todayInAppTimeZone())) {
        fail("CONFLICT", "That Loan is no longer Overdue.");
      }
      await ctx.db.patch("automationEvents", event._id, patch);
      await ctx.scheduler.runAfter(0, internal.reminders.triggerRun, {});
    },
  },
} satisfies Record<string, KindPolicy>;

export type RetryableKind = keyof typeof KIND_POLICY;

export const RETRYABLE_KINDS = Object.keys(KIND_POLICY) as RetryableKind[];

export function policyOf(kind: Event["kind"]): KindPolicy | null {
  return kind in KIND_POLICY ? KIND_POLICY[kind as RetryableKind] : null;
}

export function isStuck(
  event: Pick<Event, "kind" | "status" | "updatedAt">,
  now: number = Date.now(),
) {
  const waiting = policyOf(event.kind)?.waitsAs.includes(event.status);
  return !!waiting && now - event.updatedAt > STUCK_AFTER_MS;
}
