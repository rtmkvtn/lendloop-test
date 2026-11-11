// Test-only functions, one per wrapper kind. The two dots in the file name keep
// Convex from pushing this module; convex-test loads it through test.setup.ts.
import {
  adminMutation,
  adminQuery,
  memberMutation,
  memberQuery,
  publicQuery,
} from "./functions";

const whoAmI = {
  args: {},
  handler: async (ctx: { me: { email: string } | null }) =>
    ctx.me?.email ?? null,
};

export const publicPing = publicQuery(whoAmI);
export const memberPing = memberQuery(whoAmI);
export const memberWrite = memberMutation(whoAmI);
export const adminPing = adminQuery(whoAmI);
export const adminWrite = adminMutation(whoAmI);
