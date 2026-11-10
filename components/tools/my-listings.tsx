"use client";

import { useMutation, useQuery } from "convex/react";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
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
import { CATEGORY_LABELS, CONDITION_LABELS } from "@/convex/lib/toolFields";
import { errorMessage } from "@/lib/errors";
import { cn } from "@/lib/utils";
import { ToolFormDialog, type ToolDraft } from "./tool-form-dialog";
import { AvailabilityText } from "./tool-labels";

type Editable = { _id: Id<"tools"> } & ToolDraft;

export function MyListings() {
  const tools = useQuery(api.tools.listMine, {});
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<Editable | null>(null);
  const [deleting, setDeleting] = useState<Editable | null>(null);

  const openForm = (tool: Editable | null) => {
    setEditing(tool);
    setFormOpen(true);
  };

  return (
    <section className="space-y-4">
      <div className="flex items-center justify-between gap-4">
        <h1 className="text-2xl font-semibold tracking-tight">My listings</h1>
        <Button onClick={() => openForm(null)}>List a tool</Button>
      </div>

      {tools === undefined ? (
        <p className="text-sm text-muted-foreground">Loading your listings…</p>
      ) : tools.length === 0 ? (
        <div className="space-y-3 rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">
          <p>You haven&apos;t listed any Tools yet.</p>
          <Button variant="outline" onClick={() => openForm(null)}>
            List your first tool
          </Button>
        </div>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Tool</TableHead>
              <TableHead>Category</TableHead>
              <TableHead>Condition</TableHead>
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
                <TableCell className="max-w-md whitespace-normal">
                  <div className="font-medium">{tool.name}</div>
                  {tool.description && (
                    <div className="text-muted-foreground">
                      {tool.description}
                    </div>
                  )}
                </TableCell>
                <TableCell>{CATEGORY_LABELS[tool.category]}</TableCell>
                <TableCell>{CONDITION_LABELS[tool.condition]}</TableCell>
                <TableCell className="whitespace-normal">
                  <AvailabilityText availability={tool.availability} />
                  {tool.removed?.reason && (
                    <div className="text-xs">
                      By an Admin: {tool.removed.reason}
                    </div>
                  )}
                </TableCell>
                <TableCell className="text-right">
                  {!tool.removed && (
                    <div className="flex justify-end gap-1">
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => openForm(tool)}
                      >
                        Edit
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        className="text-destructive"
                        onClick={() => setDeleting(tool)}
                      >
                        Delete
                      </Button>
                    </div>
                  )}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}

      <ToolFormDialog
        open={formOpen}
        onOpenChange={setFormOpen}
        editing={editing}
      />
      <DeleteToolDialog tool={deleting} onClose={() => setDeleting(null)} />
    </section>
  );
}

function DeleteToolDialog({
  tool,
  onClose,
}: {
  tool: Editable | null;
  onClose: () => void;
}) {
  const remove = useMutation(api.tools.remove);
  const [busy, setBusy] = useState(false);

  async function confirm() {
    if (!tool) return;
    setBusy(true);
    try {
      await remove({ toolId: tool._id });
      toast.success(`${tool.name} deleted`);
      onClose();
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={tool !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Delete {tool?.name}?</DialogTitle>
          <DialogDescription>
            It leaves the board straight away, and any pending Requests for it
            are declined. This can&apos;t be undone.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Keep it
          </Button>
          <Button variant="destructive" disabled={busy} onClick={confirm}>
            Delete
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
