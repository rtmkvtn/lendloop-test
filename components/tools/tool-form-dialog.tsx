"use client";

import { useMutation } from "convex/react";
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
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  NativeSelect,
  NativeSelectOption,
} from "@/components/ui/native-select";
import { Textarea } from "@/components/ui/textarea";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import {
  CATEGORIES,
  CATEGORY_LABELS,
  CONDITIONS,
  CONDITION_LABELS,
  DESCRIPTION_MAX,
  NAME_MAX,
  type Category,
  type Condition,
} from "@/convex/lib/toolFields";
import { errorMessage } from "@/lib/errors";

export type ToolDraft = {
  name: string;
  category: Category;
  condition: Condition;
  description: string;
};

const EMPTY: ToolDraft = {
  name: "",
  category: "power_tools",
  condition: "good",
  description: "",
};

export function ToolFormDialog({
  open,
  onOpenChange,
  editing,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  editing: ({ _id: Id<"tools"> } & ToolDraft) | null;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        {open && (
          <ToolForm
            key={editing?._id ?? "new"}
            editing={editing}
            onDone={() => onOpenChange(false)}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}

function ToolForm({
  editing,
  onDone,
}: {
  editing: ({ _id: Id<"tools"> } & ToolDraft) | null;
  onDone: () => void;
}) {
  const create = useMutation(api.tools.create);
  const update = useMutation(api.tools.update);
  const [draft, setDraft] = useState<ToolDraft>(
    editing
      ? {
          name: editing.name,
          category: editing.category,
          condition: editing.condition,
          description: editing.description,
        }
      : EMPTY,
  );
  const [saving, setSaving] = useState(false);
  const set = <K extends keyof ToolDraft>(key: K, value: ToolDraft[K]) =>
    setDraft((d) => ({ ...d, [key]: value }));

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setSaving(true);
    try {
      if (editing) {
        await update({ toolId: editing._id, ...draft });
        toast.success("Tool updated");
      } else {
        await create(draft);
        toast.success("Tool listed");
      }
      onDone();
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={submit} className="grid gap-4">
      <DialogHeader>
        <DialogTitle>{editing ? "Edit tool" : "List a tool"}</DialogTitle>
        <DialogDescription>
          Signed-in neighbours see everything here. Visitors only see the name
          and Category.
        </DialogDescription>
      </DialogHeader>

      <div className="grid gap-2">
        <Label htmlFor="tool-name">Name</Label>
        <Input
          id="tool-name"
          required
          maxLength={NAME_MAX}
          value={draft.name}
          onChange={(e) => set("name", e.target.value)}
          placeholder="Cordless drill"
        />
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div className="grid gap-2">
          <Label htmlFor="tool-category">Category</Label>
          <NativeSelect
            id="tool-category"
            className="w-full"
            value={draft.category}
            onChange={(e) => set("category", e.target.value as Category)}
          >
            {CATEGORIES.map((c) => (
              <NativeSelectOption key={c} value={c}>
                {CATEGORY_LABELS[c]}
              </NativeSelectOption>
            ))}
          </NativeSelect>
        </div>
        <div className="grid gap-2">
          <Label htmlFor="tool-condition">Condition</Label>
          <NativeSelect
            id="tool-condition"
            className="w-full"
            value={draft.condition}
            onChange={(e) => set("condition", e.target.value as Condition)}
          >
            {CONDITIONS.map((c) => (
              <NativeSelectOption key={c} value={c}>
                {CONDITION_LABELS[c]}
              </NativeSelectOption>
            ))}
          </NativeSelect>
        </div>
      </div>

      <div className="grid gap-2">
        <Label htmlFor="tool-description">Description</Label>
        <Textarea
          id="tool-description"
          maxLength={DESCRIPTION_MAX}
          value={draft.description}
          onChange={(e) => set("description", e.target.value)}
          placeholder="What's included, anything to watch out for"
        />
        <p className="text-right text-xs text-muted-foreground">
          {draft.description.length}/{DESCRIPTION_MAX}
        </p>
      </div>

      <DialogFooter>
        <Button type="button" variant="outline" onClick={onDone}>
          Cancel
        </Button>
        <Button type="submit" disabled={saving}>
          {editing ? "Save changes" : "List tool"}
        </Button>
      </DialogFooter>
    </form>
  );
}
