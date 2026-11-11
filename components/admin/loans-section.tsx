"use client";

import { useQuery } from "convex/react";
import { useState } from "react";
import { RequestStatusBadge } from "@/components/requests/request-actions";
import { RequestDetailDrawer } from "@/components/requests/request-detail-drawer";
import { TrustedBadge } from "@/components/tools/tool-labels";
import { Badge } from "@/components/ui/badge";
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
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { activityText } from "@/lib/activity";
import { formatRange, relativeDay } from "@/lib/dates";
import { cn } from "@/lib/utils";
import { Empty, Section } from "./section";

type LoanFilter = "all" | "approved" | "overdue" | "returned";

export function LoansSection() {
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
            <NativeSelectOption value="overdue">Overdue</NativeSelectOption>
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
                      {activityText(
                        loan.activity,
                        relativeDay(loan.activity.at),
                      )}
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
