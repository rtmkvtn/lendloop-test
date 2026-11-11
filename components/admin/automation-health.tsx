"use client";

import { useMutation, useQuery } from "convex/react";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import type { WorkflowEvent } from "@/convex/lib/workflowErrors";
import { formatMoment } from "@/lib/dates";
import { errorMessage } from "@/lib/errors";
import { Empty, Section } from "./section";

const WORKFLOW_ERROR_LABELS: Record<WorkflowEvent, string> = {
  "n8n.execution_failed": "n8n run failed",
  "reminders.missed_run": "Reminder run missed",
  "reminders.trigger_failed": "Reminder run didn't start",
};

function workflowErrorLabel(event: string) {
  return event in WORKFLOW_ERROR_LABELS
    ? WORKFLOW_ERROR_LABELS[event as WorkflowEvent]
    : event;
}

export function AutomationHealth() {
  const health = useQuery(api.admin.automationHealth, {});
  const retry = useMutation(api.admin.retryEvent);
  const [busyId, setBusyId] = useState<Id<"automationEvents"> | null>(null);

  async function onRetry(eventId: Id<"automationEvents">, label: string) {
    setBusyId(eventId);
    try {
      await retry({ eventId });
      toast.success(`${label} queued again.`);
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setBusyId(null);
    }
  }

  const lastRun = health?.lastReminderRunAt;
  return (
    <Section
      title="Automation health"
      action={
        <span className="text-sm text-muted-foreground">
          Last reminder run:{" "}
          {lastRun === undefined
            ? "…"
            : lastRun === null
              ? "never"
              : formatMoment(lastRun)}
        </span>
      }
    >
      {health === undefined ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : (
        <div className="space-y-6">
          {health.events.length === 0 ? (
            <Empty>No failed or stuck emails.</Empty>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Email</TableHead>
                  <TableHead>Problem</TableHead>
                  <TableHead>Since</TableHead>
                  <TableHead>
                    <span className="sr-only">Actions</span>
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {health.events.map((event) => (
                  <TableRow key={event._id}>
                    <TableCell className="max-w-xs whitespace-normal">
                      <span className="font-medium">{event.label}</span>
                      {event.toolName && (
                        <div className="text-xs text-muted-foreground">
                          {event.toolName}
                        </div>
                      )}
                    </TableCell>
                    <TableCell className="max-w-sm whitespace-normal text-destructive">
                      {event.stuck
                        ? "Stuck: no confirmation from n8n"
                        : (event.lastError ?? "Failed")}
                    </TableCell>
                    <TableCell className="whitespace-nowrap">
                      {formatMoment(event.updatedAt)}
                    </TableCell>
                    <TableCell className="text-right">
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={busyId === event._id}
                        onClick={() => onRetry(event._id, event.label)}
                      >
                        Retry
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}

          <div className="space-y-2">
            <h3 className="text-sm font-medium">Recent workflow errors</h3>
            {health.workflowErrors.length === 0 ? (
              <Empty>No workflow errors.</Empty>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>What</TableHead>
                    <TableHead>Error</TableHead>
                    <TableHead>When</TableHead>
                    <TableHead>
                      <span className="sr-only">Execution</span>
                    </TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {health.workflowErrors.map((error) => (
                    <TableRow key={error._id}>
                      <TableCell className="max-w-xs whitespace-normal">
                        <span className="font-medium">
                          {workflowErrorLabel(error.event)}
                        </span>
                        {(error.workflowName || error.failedNode) && (
                          <div className="text-xs text-muted-foreground">
                            {[error.workflowName, error.failedNode]
                              .filter(Boolean)
                              .join(" · ")}
                          </div>
                        )}
                      </TableCell>
                      <TableCell className="max-w-sm whitespace-normal text-destructive">
                        {error.message}
                      </TableCell>
                      <TableCell className="whitespace-nowrap">
                        {formatMoment(error.at)}
                      </TableCell>
                      <TableCell className="text-right">
                        {error.executionUrl && (
                          <a
                            href={error.executionUrl}
                            target="_blank"
                            rel="noreferrer noopener"
                            className="text-sm underline underline-offset-4"
                          >
                            Open in n8n
                          </a>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </div>
        </div>
      )}
    </Section>
  );
}
