import { makeFunctionReference } from "convex/server";
import { describe, expect, test } from "vitest";
import { ANNA, OMAR, newTest, seedViewer } from "../testing.helpers";

const fixtures = "lib/wrappers.fixtures";
const publicPing = makeFunctionReference<"query">(`${fixtures}:publicPing`);
const memberPing = makeFunctionReference<"query">(`${fixtures}:memberPing`);
const memberWrite = makeFunctionReference<"mutation">(
  `${fixtures}:memberWrite`,
);
const adminPing = makeFunctionReference<"query">(`${fixtures}:adminPing`);
const adminWrite = makeFunctionReference<"mutation">(`${fixtures}:adminWrite`);

async function viewers() {
  const t = newTest();
  const member = await seedViewer(t, ANNA);
  const admin = await seedViewer(t, OMAR);
  const unregistered = t.withIdentity({
    subject: "user_no_row",
    email: "ghost@example.com",
  });
  return { t, member: member.as, admin: admin.as, unregistered };
}

const rejectsWith = (code: string) => ({ data: { code } });

describe("public wrapper", () => {
  test("lets a signed-out visitor in, with no caller loaded", async () => {
    const { t } = await viewers();
    expect(await t.query(publicPing, {})).toBeNull();
  });

  test("loads the caller for a Member and an Admin", async () => {
    const { member, admin } = await viewers();
    expect(await member.query(publicPing, {})).toBe(ANNA.email);
    expect(await admin.query(publicPing, {})).toBe(OMAR.email);
  });
});

describe("Member wrappers", () => {
  test("reject a signed-out caller with UNAUTHENTICATED", async () => {
    const { t } = await viewers();
    await expect(t.query(memberPing, {})).rejects.toMatchObject(
      rejectsWith("UNAUTHENTICATED"),
    );
    await expect(t.mutation(memberWrite, {})).rejects.toMatchObject(
      rejectsWith("UNAUTHENTICATED"),
    );
  });

  test("reject a signed-in caller who has no users row yet", async () => {
    const { unregistered } = await viewers();
    await expect(unregistered.query(memberPing, {})).rejects.toMatchObject(
      rejectsWith("UNAUTHENTICATED"),
    );
  });

  test("load the caller for a Member and an Admin", async () => {
    const { member, admin } = await viewers();
    expect(await member.query(memberPing, {})).toBe(ANNA.email);
    expect(await member.mutation(memberWrite, {})).toBe(ANNA.email);
    expect(await admin.query(memberPing, {})).toBe(OMAR.email);
    expect(await admin.mutation(memberWrite, {})).toBe(OMAR.email);
  });
});

describe("Admin wrappers", () => {
  test("reject a signed-out caller with UNAUTHENTICATED", async () => {
    const { t } = await viewers();
    await expect(t.query(adminPing, {})).rejects.toMatchObject(
      rejectsWith("UNAUTHENTICATED"),
    );
    await expect(t.mutation(adminWrite, {})).rejects.toMatchObject(
      rejectsWith("UNAUTHENTICATED"),
    );
  });

  test("reject a Member with FORBIDDEN", async () => {
    const { member } = await viewers();
    await expect(member.query(adminPing, {})).rejects.toMatchObject(
      rejectsWith("FORBIDDEN"),
    );
    await expect(member.mutation(adminWrite, {})).rejects.toMatchObject(
      rejectsWith("FORBIDDEN"),
    );
  });

  test("load the caller for an Admin", async () => {
    const { admin } = await viewers();
    expect(await admin.query(adminPing, {})).toBe(OMAR.email);
    expect(await admin.mutation(adminWrite, {})).toBe(OMAR.email);
  });
});
