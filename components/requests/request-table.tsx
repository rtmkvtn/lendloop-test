"use client";

import type { FunctionReturnType } from "convex/server";
import Link from "next/link";
import { useState } from "react";
import { TrustedBadge } from "@/components/tools/tool-labels";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { formatRange } from "@/lib/dates";
import { RequestActions, RequestStatusBadge } from "./request-actions";
import { RequestDetailDrawer } from "./request-detail-drawer";

export type RequestRow = FunctionReturnType<
  typeof api.requests.listMine
>[number];

export function RequestTable({
  rows,
  perspective,
}: {
  rows: RequestRow[];
  perspective: "borrower" | "lender";
}) {
  const [openId, setOpenId] = useState<Id<"requests"> | null>(null);

  return (
    <>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Tool</TableHead>
            <TableHead>
              {perspective === "borrower" ? "Lender" : "Borrower"}
            </TableHead>
            <TableHead>Dates</TableHead>
            <TableHead>Status</TableHead>
            <TableHead>
              <span className="sr-only">Actions</span>
            </TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((row) => (
            <TableRow
              key={row._id}
              className="cursor-pointer"
              onClick={() => setOpenId(row._id)}
            >
              <TableCell className="max-w-xs whitespace-normal">
                <button
                  type="button"
                  className="text-left font-medium underline-offset-3 hover:underline"
                  onClick={(e) => {
                    e.stopPropagation();
                    setOpenId(row._id);
                  }}
                >
                  {row.tool.name}
                </button>
                {row.tool.removed && (
                  <span className="text-muted-foreground"> (removed)</span>
                )}
              </TableCell>
              <TableCell>
                {perspective === "borrower" ? (
                  <span className="flex items-center gap-2">
                    {row.lender.name}
                    {row.lender.trusted && <TrustedBadge />}
                  </span>
                ) : (
                  row.borrower.name
                )}
              </TableCell>
              <TableCell className="whitespace-nowrap">
                {formatRange(row.startDate, row.endDate)}
              </TableCell>
              <TableCell>
                <span className="flex items-center gap-1">
                  <RequestStatusBadge status={row.status} />
                  {row.overdue && <Badge variant="destructive">Overdue</Badge>}
                </span>
              </TableCell>
              <TableCell className="text-right">
                <RequestActions requestId={row._id} actions={row.actions} />
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
      <RequestDetailDrawer requestId={openId} onClose={() => setOpenId(null)} />
    </>
  );
}

export function RequestsEmpty({ children }: { children: React.ReactNode }) {
  return (
    <p className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">
      {children}
    </p>
  );
}

export function BoardLink({ children }: { children: React.ReactNode }) {
  return (
    <Link href="/tools" className="underline underline-offset-3">
      {children}
    </Link>
  );
}
