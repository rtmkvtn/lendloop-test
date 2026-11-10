"use client";

import { useQuery } from "convex/react";
import { PagePlaceholder } from "@/components/page-placeholder";
import { api } from "@/convex/_generated/api";

// UI gate only; every Admin function is enforced by the adminQuery/adminMutation wrappers.
export default function AdminPage() {
  const me = useQuery(api.users.me);
  if (me === undefined) return null;
  if (me?.role !== "admin") {
    return (
      <PagePlaceholder title="Admin" empty="This page is only for Admins." />
    );
  }
  return (
    <PagePlaceholder
      title="Admin"
      empty="Loans, Lenders, Listings and Automation health will appear here."
    />
  );
}
