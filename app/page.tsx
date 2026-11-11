import { Show, SignInButton } from "@clerk/nextjs";
import Link from "next/link";
import { Suspense } from "react";
import { PublicToolList } from "@/components/tools/public-tool-list";
import { Button } from "@/components/ui/button";

export default function Landing() {
  return (
    <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col justify-center gap-8 px-6 py-16">
      <div className="space-y-3">
        <p className="text-sm font-medium tracking-wide text-muted-foreground uppercase">
          LendLoop
        </p>
        <h1 className="text-4xl font-semibold tracking-tight text-balance">
          Borrow what you need. Lend what you don&apos;t.
        </h1>
        <p className="max-w-xl text-muted-foreground">
          A neighbourhood board for lending tools to each other for a few days.
        </p>
      </div>
      <Suspense fallback={<div className="h-9" />}>
        <Show when="signed-out">
          <SignInButton mode="modal" forceRedirectUrl="/tools">
            <Button size="lg" className="w-fit">
              Sign in to lend or borrow
            </Button>
          </SignInButton>
        </Show>
        <Show when="signed-in">
          <Button asChild size="lg" className="w-fit">
            <Link href="/tools">Open the board</Link>
          </Button>
        </Show>
      </Suspense>
      <PublicToolList />
    </main>
  );
}
