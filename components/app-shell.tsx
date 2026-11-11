"use client";

import { SignOutButton } from "@clerk/nextjs";
import { useConvexAuth, useMutation, useQuery } from "convex/react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { api } from "@/convex/_generated/api";
import { errorMessage } from "@/lib/errors";
import { cn } from "@/lib/utils";

const MEMBER_NAV = [
  { href: "/tools", label: "All tools" },
  { href: "/listings", label: "My listings" },
  { href: "/requests", label: "My requests" },
  { href: "/incoming", label: "Incoming" },
] as const;
const ADMIN_NAV = { href: "/admin", label: "Admin" } as const;

function useEnsureMe() {
  const { isAuthenticated } = useConvexAuth();
  const ensureMe = useMutation(api.users.ensureMe);
  const me = useQuery(api.users.me, isAuthenticated ? {} : "skip");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!isAuthenticated) return;
    ensureMe({}).catch((e: unknown) => setError(errorMessage(e)));
  }, [isAuthenticated, ensureMe]);

  return { me, error };
}

export function AppShell({ children }: { children: React.ReactNode }) {
  const { me, error } = useEnsureMe();
  const pathname = usePathname();
  const pendingIncoming = useQuery(
    api.requests.countPendingIncoming,
    me ? {} : "skip",
  );

  if (error) {
    return (
      <main className="mx-auto flex max-w-lg flex-1 flex-col justify-center gap-4 px-6">
        <h1 className="text-xl font-semibold">
          We couldn&apos;t set up your account
        </h1>
        <p className="text-muted-foreground">{error}</p>
        <SignOutButton>
          <Button variant="outline" className="w-fit">
            Sign out
          </Button>
        </SignOutButton>
      </main>
    );
  }

  if (!me) {
    return (
      <main className="flex flex-1 items-center justify-center text-sm text-muted-foreground">
        Loading your account…
      </main>
    );
  }

  const nav = me.role === "admin" ? [...MEMBER_NAV, ADMIN_NAV] : MEMBER_NAV;

  return (
    <div className="flex flex-1 flex-col min-[720px]:flex-row">
      <aside className="flex flex-col border-b bg-sidebar text-sidebar-foreground min-[720px]:w-56 min-[720px]:shrink-0 min-[720px]:border-r min-[720px]:border-b-0">
        <div className="flex items-center justify-between gap-2 px-4 pt-3 min-[720px]:flex-col min-[720px]:items-start min-[720px]:pt-5">
          <Link href="/tools" className="font-semibold">
            LendLoop
          </Link>
          <span
            className="truncate text-sm text-muted-foreground"
            title={me.email}
          >
            {me.name}
          </span>
          <SignOutButton>
            <Button variant="ghost" size="sm" className="min-[720px]:-ml-2">
              Sign out
            </Button>
          </SignOutButton>
        </div>
        <nav
          aria-label="Main"
          className="flex overflow-x-auto px-2 py-2 min-[720px]:flex-col min-[720px]:py-4"
        >
          {nav.map((item) => {
            const active =
              pathname === item.href || pathname.startsWith(`${item.href}/`);
            return (
              <Link
                key={item.href}
                href={item.href}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "shrink-0 rounded-md px-3 py-2 text-sm whitespace-nowrap hover:bg-sidebar-accent",
                  active &&
                    "bg-sidebar-accent font-medium text-sidebar-accent-foreground",
                )}
              >
                {item.label}
                {item.href === "/incoming" && pendingIncoming ? (
                  <span
                    className="ml-2 rounded-full bg-primary px-1.5 py-0.5 text-xs font-medium text-primary-foreground tabular-nums"
                    aria-label={`${pendingIncoming} pending`}
                  >
                    {pendingIncoming}
                  </span>
                ) : null}
              </Link>
            );
          })}
        </nav>
      </aside>
      <main className="flex-1 px-6 py-6">{children}</main>
    </div>
  );
}
