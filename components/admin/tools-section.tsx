"use client";

import { useMutation, useQuery } from "convex/react";
import { useState } from "react";
import { toast } from "sonner";
import { AvailabilityText, TrustedBadge } from "@/components/tools/tool-labels";
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
import { errorMessage } from "@/lib/errors";
import { cn } from "@/lib/utils";
import { Empty, Section } from "./section";

type Removable = { _id: Id<"tools">; name: string };

export function ToolsSection() {
  const tools = useQuery(api.admin.listTools, {});
  const [removing, setRemoving] = useState<Removable | null>(null);

  return (
    <Section title="Tools">
      {tools === undefined ? (
        <p className="text-sm text-muted-foreground">Loading Tools…</p>
      ) : tools.length === 0 ? (
        <Empty>No Tools on LendLoop yet.</Empty>
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
            {tools.map((tool) => (
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
              Remove Tool
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
