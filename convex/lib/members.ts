import type { Doc } from "../_generated/dataModel";

// users.ensureMe falls back to the email when Clerk sends no name, and other
// Members must never see an email.
export function displayName(user: Doc<"users"> | null) {
  if (!user || user.name.includes("@")) return "A LendLoop member";
  return user.name;
}
