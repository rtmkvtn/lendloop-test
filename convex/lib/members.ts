import type { Doc } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";

// users.ensureMe falls back to the email when Clerk sends no name, and other
// Members must never see an email.
export function displayName(user: Doc<"users"> | null) {
  if (!user || user.name.includes("@")) return "A LendLoop member";
  return user.name;
}

export function lenderOf(user: Doc<"users"> | null) {
  return { name: displayName(user), trusted: user?.trustedLender ?? false };
}

// Emails aren't unique across rows: a Clerk account deleted and re-created
// leaves an orphaned row with the same email. Promote them all, and hand back
// the newest, which is the account signed in now.
export async function promoteByEmail(ctx: MutationCtx, email: string) {
  const rows = await ctx.db
    .query("users")
    .withIndex("by_email", (q) => q.eq("email", email))
    .collect();
  for (const row of rows) {
    if (row.role !== "admin") {
      await ctx.db.patch("users", row._id, { role: "admin" });
    }
  }
  return rows.at(-1) ?? null;
}
