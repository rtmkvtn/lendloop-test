"use client";

import { useMutation } from "convex/react";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { api } from "@/convex/_generated/api";
import { errorMessage } from "@/lib/errors";
import { AutomationHealth } from "./automation-health";
import { LendersSection } from "./lenders-section";
import { LoansSection } from "./loans-section";
import { ToolsSection } from "./tools-section";

export function AdminConsole() {
  return (
    <div className="space-y-10">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <h1 className="text-2xl font-semibold tracking-tight">Admin</h1>
        <RunRemindersButton />
      </div>
      <AutomationHealth />
      <LoansSection />
      <LendersSection />
      <ToolsSection />
    </div>
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
