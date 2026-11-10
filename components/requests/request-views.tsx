"use client";

import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { BoardLink, RequestTable, RequestsEmpty } from "./request-table";

export function MyRequests() {
  const rows = useQuery(api.requests.listMine, {});
  return (
    <section className="space-y-4">
      <h1 className="text-2xl font-semibold tracking-tight">My requests</h1>
      {rows === undefined ? (
        <p className="text-sm text-muted-foreground">Loading your requests…</p>
      ) : rows.length === 0 ? (
        <RequestsEmpty>
          You haven&apos;t requested any Tools yet.{" "}
          <BoardLink>Find one in All tools.</BoardLink>
        </RequestsEmpty>
      ) : (
        <RequestTable rows={rows} perspective="borrower" />
      )}
    </section>
  );
}

export function IncomingRequests() {
  const rows = useQuery(api.requests.listIncoming, {});
  return (
    <section className="space-y-4">
      <h1 className="text-2xl font-semibold tracking-tight">
        Incoming requests
      </h1>
      {rows === undefined ? (
        <p className="text-sm text-muted-foreground">
          Loading incoming requests…
        </p>
      ) : rows.length === 0 ? (
        <RequestsEmpty>
          No one has asked to borrow your Tools yet. Listing more in My listings
          gives neighbours more to ask for.
        </RequestsEmpty>
      ) : (
        <RequestTable rows={rows} perspective="lender" />
      )}
    </section>
  );
}
