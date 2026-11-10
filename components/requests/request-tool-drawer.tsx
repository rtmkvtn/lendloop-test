"use client";

import { useMutation } from "convex/react";
import Link from "next/link";
import { useState } from "react";
import { toast } from "sonner";
import { AvailabilityText, TrustedBadge } from "@/components/tools/tool-labels";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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
import type { Availability } from "@/convex/lib/availability";
import { MAX_REQUEST_DAYS } from "@/convex/lib/requestFields";
import { CATEGORY_LABELS, CONDITION_LABELS } from "@/convex/lib/toolFields";
import type { Category, Condition } from "@/convex/lib/toolFields";
import { addDays, localToday } from "@/lib/dates";
import { errorMessage } from "@/lib/errors";

export type RequestableTool = {
  _id: Id<"tools">;
  name: string;
  category: Category;
  condition: Condition;
  description: string;
  lender: { name: string; trusted: boolean };
  availability: Availability | null;
};

export function RequestToolDrawer({
  tool,
  onClose,
}: {
  tool: RequestableTool | null;
  onClose: () => void;
}) {
  return (
    <Sheet open={tool !== null} onOpenChange={(open) => !open && onClose()}>
      <SheetContent className="sm:max-w-md">
        {tool && <RequestForm key={tool._id} tool={tool} onDone={onClose} />}
      </SheetContent>
    </Sheet>
  );
}

function RequestForm({
  tool,
  onDone,
}: {
  tool: RequestableTool;
  onDone: () => void;
}) {
  const create = useMutation(api.requests.create);
  const today = localToday();
  const [startDate, setStartDate] = useState(today);
  const [endDate, setEndDate] = useState(today);
  const [sending, setSending] = useState(false);
  const lastEnd = addDays(startDate || today, MAX_REQUEST_DAYS - 1);

  function changeStart(value: string) {
    setStartDate(value);
    if (
      value &&
      (endDate < value || endDate > addDays(value, MAX_REQUEST_DAYS - 1))
    ) {
      setEndDate(value);
    }
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setSending(true);
    try {
      await create({ toolId: tool._id, startDate, endDate });
      toast.success(`Request sent to ${tool.lender.name}`);
      onDone();
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setSending(false);
    }
  }

  return (
    <form onSubmit={submit} className="flex h-full flex-col">
      <SheetHeader>
        <SheetTitle>Request {tool.name}</SheetTitle>
        <SheetDescription>
          {CATEGORY_LABELS[tool.category]} · {CONDITION_LABELS[tool.condition]}
        </SheetDescription>
      </SheetHeader>

      <div className="grid gap-5 px-4">
        <dl className="grid gap-3 text-sm">
          {tool.description && (
            <div>
              <dt className="sr-only">Description</dt>
              <dd>{tool.description}</dd>
            </div>
          )}
          <div className="flex items-center gap-2">
            <dt className="text-muted-foreground">Lender</dt>
            <dd className="flex items-center gap-2">
              {tool.lender.name}
              {tool.lender.trusted && <TrustedBadge />}
            </dd>
          </div>
          <div className="flex items-center gap-2">
            <dt className="text-muted-foreground">Now</dt>
            <dd>
              <AvailabilityText availability={tool.availability} />
            </dd>
          </div>
        </dl>

        <div className="grid grid-cols-2 gap-4">
          <div className="grid gap-2">
            <Label htmlFor="request-from">From</Label>
            <Input
              id="request-from"
              type="date"
              required
              min={today}
              value={startDate}
              onChange={(e) => changeStart(e.target.value)}
            />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="request-to">To</Label>
            <Input
              id="request-to"
              type="date"
              required
              min={startDate || today}
              max={lastEnd}
              value={endDate}
              onChange={(e) => setEndDate(e.target.value)}
            />
          </div>
        </div>
        <p className="text-xs text-muted-foreground">
          Up to {MAX_REQUEST_DAYS} days. {tool.lender.name} gets an email about
          your Request and will approve or decline it. You&apos;ll get an email
          either way, and can follow it in{" "}
          <Link href="/requests" className="underline underline-offset-3">
            My requests
          </Link>
          .
        </p>
      </div>

      <SheetFooter className="flex-row justify-end">
        <Button type="button" variant="outline" onClick={onDone}>
          Cancel
        </Button>
        <Button type="submit" disabled={sending}>
          Send request
        </Button>
      </SheetFooter>
    </form>
  );
}
