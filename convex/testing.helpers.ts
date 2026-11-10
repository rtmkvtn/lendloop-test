import { convexTest } from "convex-test";
import schema from "./schema";
import { modules } from "./test.setup";

export const TEST_ISSUER = "https://convex.test";

export function newTest() {
  return convexTest(schema, modules);
}

export type TestConvex = ReturnType<typeof newTest>;

type ViewerSpec = {
  subject: string;
  name: string;
  email: string;
  role?: "user" | "admin";
  trustedLender?: boolean;
};

export async function seedViewer(t: TestConvex, spec: ViewerSpec) {
  const userId = await t.run((ctx) =>
    ctx.db.insert("users", {
      tokenIdentifier: `${TEST_ISSUER}|${spec.subject}`,
      name: spec.name,
      email: spec.email,
      role: spec.role ?? "user",
      trustedLender: spec.trustedLender ?? false,
    }),
  );
  const as = t.withIdentity({
    issuer: TEST_ISSUER,
    subject: spec.subject,
    name: spec.name,
    email: spec.email,
  });
  return { userId, as };
}

export const ANNA = {
  subject: "user_anna",
  name: "Anna Lee",
  email: "anna@example.com",
};

export const OMAR = {
  subject: "user_omar",
  name: "Omar Haddad",
  email: "omar@example.com",
  role: "admin" as const,
};
