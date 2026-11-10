"use client";

import { useQueries } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import { useMemo } from "react";
import { TrustedBadge } from "@/components/tools/tool-labels";
import { Badge } from "@/components/ui/badge";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { formatMoment, formatRange } from "@/lib/dates";
import { errorMessage } from "@/lib/errors";
import { cn } from "@/lib/utils";
import { RequestActions, RequestStatusBadge } from "./request-actions";

export function RequestDetailDrawer({
  requestId,
  onClose,
}: {
  requestId: Id<"requests"> | null;
  onClose: () => void;
}) {
  return (
    <Sheet
      open={requestId !== null}
      onOpenChange={(open) => !open && onClose()}
    >
      <SheetContent className="sm:max-w-md">
        {requestId && <RequestDetail requestId={requestId} />}
      </SheetContent>
    </Sheet>
  );
}

function RequestDetail({ requestId }: { requestId: Id<"requests"> }) {
  const request = useQueryOrError(requestId);

  if (request.error) {
    return (
      <SheetHeader>
        <SheetTitle>Request</SheetTitle>
        <SheetDescription>{request.error}</SheetDescription>
      </SheetHeader>
    );
  }
  const r = request.data;
  if (!r) {
    return (
      <SheetHeader>
        <SheetTitle>Request</SheetTitle>
        <SheetDescription>Loading…</SheetDescription>
      </SheetHeader>
    );
  }

  return (
    <>
      <SheetHeader>
        <SheetTitle>
          {r.tool.name}
          {r.tool.removed && (
            <span className="text-muted-foreground"> (removed)</span>
          )}
        </SheetTitle>
        <SheetDescription>
          {formatRange(r.startDate, r.endDate)}
        </SheetDescription>
      </SheetHeader>

      <div className="grid gap-5 px-4">
        <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2">
          <dt className="text-muted-foreground">Status</dt>
          <dd className="flex items-center gap-1">
            <RequestStatusBadge status={r.status} />
            {r.overdue && <Badge variant="destructive">Overdue</Badge>}
          </dd>
          <dt className="text-muted-foreground">Lender</dt>
          <dd className="flex items-center gap-2">
            {r.lender.name}
            {r.lender.trusted && <TrustedBadge />}
          </dd>
          <dt className="text-muted-foreground">Borrower</dt>
          <dd>{r.borrower.name}</dd>
        </dl>

        <section className="grid gap-2">
          <h3 className="font-medium">Activity</h3>
          <ol className="grid gap-3 border-l pl-4">
            {[...r.history].reverse().map((entry, i) => (
              <li key={`${entry.at}-${i}`} className="relative">
                <span
                  className={cn(
                    "absolute top-1.5 -left-[1.3rem] size-2 rounded-full",
                    entry.failed ? "bg-destructive" : "bg-muted-foreground",
                  )}
                />
                <div className={cn(entry.failed && "text-destructive")}>
                  {entry.label}
                </div>
                <div className="text-xs text-muted-foreground">
                  {formatMoment(entry.at)}
                </div>
              </li>
            ))}
          </ol>
        </section>
      </div>

      <SheetFooter className="flex-row justify-end">
        <RequestActions requestId={r._id} actions={r.actions} />
      </SheetFooter>
    </>
  );
}

type RequestDetail = FunctionReturnType<typeof api.requests.get>;

// useQueries returns errors as values instead of throwing, and NOT_FOUND is a
// normal outcome for a stale link.
function useQueryOrError(requestId: Id<"requests">) {
  const queries = useMemo(
    () => ({ request: { query: api.requests.get, args: { requestId } } }),
    [requestId],
  );
  const { request } = useQueries(queries);
  if (request instanceof Error) {
    return { data: undefined, error: errorMessage(request) };
  }
  return { data: request as RequestDetail | undefined, error: null };
}
