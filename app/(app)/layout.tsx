import { auth } from "@clerk/nextjs/server";
import { Suspense } from "react";
import { AppShell } from "@/components/app-shell";

async function RequireSignIn() {
  await auth.protect();
  return null;
}

// The session check is a sibling, not a wrapper: awaiting it around
// {children} holds every page out of the instant-navigation shell.
export default function AppLayout({ children }: LayoutProps<"/">) {
  return (
    <AppShell>
      <Suspense>
        <RequireSignIn />
      </Suspense>
      {children}
    </AppShell>
  );
}
