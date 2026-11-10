"use client";

import { useMutation } from "convex/react";
import { useState } from "react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import {
  REQUEST_STATUS_LABELS,
  type RequestAction,
  type RequestStatus,
} from "@/convex/lib/requestFields";
import { errorMessage } from "@/lib/errors";

const ACTION_COPY: Record<
  RequestAction,
  { label: string; done: string; variant: "default" | "outline" | "ghost" }
> = {
  approve: { label: "Approve", done: "Approved", variant: "default" },
  decline: { label: "Decline", done: "Declined", variant: "outline" },
  markReturned: {
    label: "Mark returned",
    done: "Marked returned",
    variant: "outline",
  },
  cancel: { label: "Cancel", done: "Request cancelled", variant: "outline" },
};

export function RequestActions({
  requestId,
  actions,
}: {
  requestId: Id<"requests">;
  actions: RequestAction[];
}) {
  const mutations = {
    approve: useMutation(api.requests.approve),
    decline: useMutation(api.requests.decline),
    markReturned: useMutation(api.requests.markReturned),
    cancel: useMutation(api.requests.cancel),
  };
  const [busy, setBusy] = useState<RequestAction | null>(null);

  async function run(action: RequestAction) {
    setBusy(action);
    try {
      await mutations[action]({ requestId });
      toast.success(ACTION_COPY[action].done);
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setBusy(null);
    }
  }

  if (actions.length === 0) return null;
  return (
    <div className="flex justify-end gap-1">
      {actions.map((action) => (
        <Button
          key={action}
          size="sm"
          variant={ACTION_COPY[action].variant}
          disabled={busy !== null}
          onClick={(e) => {
            e.stopPropagation();
            void run(action);
          }}
        >
          {ACTION_COPY[action].label}
        </Button>
      ))}
    </div>
  );
}

const STATUS_VARIANT: Record<
  RequestStatus,
  "default" | "secondary" | "outline" | "destructive"
> = {
  pending: "outline",
  approved: "default",
  declined: "secondary",
  cancelled: "secondary",
  returned: "secondary",
};

export function RequestStatusBadge({ status }: { status: RequestStatus }) {
  return (
    <Badge variant={STATUS_VARIANT[status]}>
      {REQUEST_STATUS_LABELS[status]}
    </Badge>
  );
}
