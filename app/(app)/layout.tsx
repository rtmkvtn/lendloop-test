import { auth } from "@clerk/nextjs/server";
import { Suspense } from "react";
import { AppShell } from "@/components/app-shell";

async function SignedInOnly({ children }: { children: React.ReactNode }) {
  await auth.protect();
  return <AppShell>{children}</AppShell>;
}

export default function AppLayout({ children }: LayoutProps<"/">) {
  return (
    <Suspense>
      <SignedInOnly>{children}</SignedInOnly>
    </Suspense>
  );
}
