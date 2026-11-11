"use client";

import { useMutation, useQuery } from "convex/react";
import { useState } from "react";
import { toast } from "sonner";
import { TrustedBadge } from "@/components/tools/tool-labels";
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
import { errorMessage } from "@/lib/errors";
import { Empty, Section } from "./section";

export function LendersSection() {
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
              <TableHead>Tools</TableHead>
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
                <TableCell>{lender.tools}</TableCell>
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
