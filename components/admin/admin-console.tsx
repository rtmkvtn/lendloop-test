"use client";

import { useMutation, useQuery } from "convex/react";
import { useState } from "react";
import { toast } from "sonner";
import { RequestStatusBadge } from "@/components/requests/request-actions";
import { RequestDetailDrawer } from "@/components/requests/request-detail-drawer";
import { AvailabilityText, TrustedBadge } from "@/components/tools/tool-labels";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import {
  NativeSelect,
  NativeSelectOption,
} from "@/components/ui/native-select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { CATEGORY_LABELS, REASON_MAX } from "@/convex/lib/toolFields";
import { formatRange, relativeDay } from "@/lib/dates";
import { errorMessage } from "@/lib/errors";
import { cn } from "@/lib/utils";

export function AdminConsole() {
  return (
    <div className="space-y-10">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <h1 className="text-2xl font-semibold tracking-tight">Admin</h1>
        <RunRemindersButton />
      </div>
      <LoansTable />
      <LendersTable />
      <ListingsTable />
    </div>
  );
}

function Section({
  title,
  action,
  children,
}: {
  title: string;
  action?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-lg font-semibold">{title}</h2>
        {action}
      </div>
      {children}
    </section>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return (
    <p className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">
      {children}
    </p>
  );
}

function RunRemindersButton() {
  const run = useMutation(api.admin.runRemindersNow);
  const [busy, setBusy] = useState(false);
  async function onClick() {
    setBusy(true);
    try {
      await run({});
      toast.success("Reminder run started. Overdue Borrowers will be emailed.");
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <Button variant="outline" disabled={busy} onClick={onClick}>
      Run reminders now
    </Button>
  );
}

type LoanFilter = "all" | "approved" | "returned";

function LoansTable() {
  const [filter, setFilter] = useState<LoanFilter>("all");
  const loans = useQuery(
    api.admin.listLoans,
    filter === "all" ? {} : { status: filter },
  );
  const [openId, setOpenId] = useState<Id<"requests"> | null>(null);

  return (
    <Section
      title="Loans"
      action={
        <div className="flex items-center gap-2">
          <Label htmlFor="loan-filter" className="text-muted-foreground">
            Status
          </Label>
          <NativeSelect
            id="loan-filter"
            size="sm"
            value={filter}
            onChange={(e) => setFilter(e.target.value as LoanFilter)}
          >
            <NativeSelectOption value="all">All</NativeSelectOption>
            <NativeSelectOption value="approved">On loan</NativeSelectOption>
            <NativeSelectOption value="returned">Returned</NativeSelectOption>
          </NativeSelect>
        </div>
      }
    >
      {loans === undefined ? (
        <p className="text-sm text-muted-foreground">Loading Loans…</p>
      ) : loans.length === 0 ? (
        <Empty>No Loans match this filter.</Empty>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Tool</TableHead>
              <TableHead>Lender</TableHead>
              <TableHead>Borrower</TableHead>
              <TableHead>Dates</TableHead>
              <TableHead>Status</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {loans.map((loan) => (
              <TableRow
                key={loan._id}
                className="cursor-pointer"
                onClick={() => setOpenId(loan._id)}
              >
                <TableCell className="max-w-xs whitespace-normal">
                  <span className="font-medium">{loan.tool.name}</span>
                  {loan.tool.removed && (
                    <span className="text-muted-foreground"> (removed)</span>
                  )}
                  {loan.activity && (
                    <div
                      className={cn(
                        "text-xs",
                        loan.activity.failed
                          ? "text-destructive"
                          : "text-muted-foreground",
                      )}
                    >
                      {loan.activity.label} {relativeDay(loan.activity.at)}
                    </div>
                  )}
                </TableCell>
                <TableCell>
                  <span className="flex items-center gap-2">
                    {loan.lender.name}
                    {loan.lender.trusted && <TrustedBadge />}
                  </span>
                </TableCell>
                <TableCell>{loan.borrower.name}</TableCell>
                <TableCell className="whitespace-nowrap">
                  {formatRange(loan.startDate, loan.endDate)}
                </TableCell>
                <TableCell>
                  <span className="flex items-center gap-1">
                    <RequestStatusBadge status={loan.status} />
                    {loan.overdue && (
                      <Badge variant="destructive">Overdue</Badge>
                    )}
                  </span>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
      <RequestDetailDrawer requestId={openId} onClose={() => setOpenId(null)} />
    </Section>
  );
}

function LendersTable() {
  const lenders = useQuery(api.admin.listLenders, {});
  const setTrusted = useMutation(api.admin.setTrustedLender);
  const [busyId, setBusyId] = useState<Id<"users"> | null>(null);

  async function toggle(userId: Id<"users">, name: string, trusted: boolean) {
    setBusyId(userId);
    try {
      await setTrusted({ userId, trusted });
      toast.success(
        trusted
          ? `${name} is now a Trusted Lender`
          : `${name} is no longer a Trusted Lender`,
      );
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setBusyId(null);
    }
  }

  return (
    <Section title="Lenders">
      {lenders === undefined ? (
        <p className="text-sm text-muted-foreground">Loading Lenders…</p>
      ) : lenders.length === 0 ? (
        <Empty>No Members yet.</Empty>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Member</TableHead>
              <TableHead>Listings</TableHead>
              <TableHead>
                <span className="sr-only">Trusted Lender</span>
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {lenders.map((lender) => (
              <TableRow key={lender._id}>
                <TableCell>
                  <span className="flex items-center gap-2">
                    {lender.name}
                    {lender.trusted && <TrustedBadge />}
                  </span>
                </TableCell>
                <TableCell>{lender.listings}</TableCell>
                <TableCell className="text-right">
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={busyId === lender._id}
                    onClick={() =>
                      toggle(lender._id, lender.name, !lender.trusted)
                    }
                  >
                    {lender.trusted ? "Revoke Trusted" : "Mark Trusted"}
                  </Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </Section>
  );
}

type Removable = { _id: Id<"tools">; name: string };

function ListingsTable() {
  const listings = useQuery(api.admin.listListings, {});
  const [removing, setRemoving] = useState<Removable | null>(null);

  return (
    <Section title="Listings">
      {listings === undefined ? (
        <p className="text-sm text-muted-foreground">Loading listings…</p>
      ) : listings.length === 0 ? (
        <Empty>No Tools have been listed yet.</Empty>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Tool</TableHead>
              <TableHead>Lender</TableHead>
              <TableHead>Category</TableHead>
              <TableHead>Availability</TableHead>
              <TableHead>
                <span className="sr-only">Actions</span>
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {listings.map((tool) => (
              <TableRow
                key={tool._id}
                className={cn(tool.removed && "text-muted-foreground")}
              >
                <TableCell className="font-medium">{tool.name}</TableCell>
                <TableCell>
                  <span className="flex items-center gap-2">
                    {tool.lender.name}
                    {tool.lender.trusted && <TrustedBadge />}
                  </span>
                </TableCell>
                <TableCell>{CATEGORY_LABELS[tool.category]}</TableCell>
                <TableCell className="max-w-xs whitespace-normal">
                  <AvailabilityText availability={tool.availability} />
                  {tool.removed?.reason && (
                    <div className="text-xs">{tool.removed.reason}</div>
                  )}
                </TableCell>
                <TableCell className="text-right">
                  {!tool.removed && (
                    <Button
                      size="sm"
                      variant="ghost"
                      className="text-destructive"
                      onClick={() => setRemoving(tool)}
                    >
                      Remove
                    </Button>
                  )}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
      <RemoveToolDialog tool={removing} onClose={() => setRemoving(null)} />
    </Section>
  );
}

function RemoveToolDialog({
  tool,
  onClose,
}: {
  tool: Removable | null;
  onClose: () => void;
}) {
  const remove = useMutation(api.admin.removeTool);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);

  function close() {
    setReason("");
    onClose();
  }

  async function confirm(e: React.FormEvent) {
    e.preventDefault();
    if (!tool) return;
    setBusy(true);
    try {
      await remove({ toolId: tool._id, reason });
      toast.success(`${tool.name} removed. The Lender has been emailed.`);
      close();
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={tool !== null} onOpenChange={(open) => !open && close()}>
      <DialogContent>
        <form onSubmit={confirm} className="space-y-4">
          <DialogHeader>
            <DialogTitle>Remove {tool?.name}?</DialogTitle>
            <DialogDescription>
              It leaves the board, and pending Requests for it are declined. A
              live Loan stays open until the Lender marks it returned. The
              Lender is emailed your reason.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label htmlFor="removal-reason">Reason</Label>
            <Textarea
              id="removal-reason"
              required
              maxLength={REASON_MAX}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
            />
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={close}>
              Cancel
            </Button>
            <Button
              type="submit"
              variant="destructive"
              disabled={busy || !reason.trim()}
            >
              Remove listing
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
