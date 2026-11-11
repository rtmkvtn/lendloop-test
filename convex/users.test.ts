import { describe, expect, test } from "vitest";
import { api, internal } from "./_generated/api";
import * as users from "./users";
import { ANNA, TEST_ISSUER, newTest, seedViewer } from "./testing.helpers";

const annaIdentity = {
  issuer: TEST_ISSUER,
  subject: ANNA.subject,
  name: ANNA.name,
  email: ANNA.email,
};

async function allUsers(t: ReturnType<typeof newTest>) {
  return await t.run((ctx) => ctx.db.query("users").collect());
}

describe("users.ensureMe", () => {
  test("rejects a signed-out caller", async () => {
    const t = newTest();
    await expect(t.mutation(api.users.ensureMe, {})).rejects.toMatchObject({
      data: { code: "UNAUTHENTICATED" },
    });
  });

  test("creates the row on first sign-in as a regular Member", async () => {
    const t = newTest();
    await t.withIdentity(annaIdentity).mutation(api.users.ensureMe, {});

    const rows = await allUsers(t);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      tokenIdentifier: `${TEST_ISSUER}|${ANNA.subject}`,
      name: "Anna Lee",
      email: "anna@example.com",
      role: "user",
      trustedLender: false,
    });
  });

  test("is idempotent and refreshes name and email from Clerk", async () => {
    const t = newTest();
    await t.withIdentity(annaIdentity).mutation(api.users.ensureMe, {});
    await t
      .withIdentity({
        ...annaIdentity,
        name: "Anna Lee-Park",
        email: "Anna.Park@Example.com",
      })
      .mutation(api.users.ensureMe, {});

    const rows = await allUsers(t);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      name: "Anna Lee-Park",
      email: "anna.park@example.com",
    });
  });

  test.each([
    ["the given_name claim", { givenName: "Annie" }, "Annie"],
    ["the first word of the name", {}, "Anna"],
    ["the part of the email before the @", { name: undefined }, "anna"],
  ])("stores a first name from %s", async (_label, claims, firstName) => {
    const t = newTest();
    await t
      .withIdentity({ ...annaIdentity, ...claims })
      .mutation(api.users.ensureMe, {});

    const rows = await allUsers(t);
    expect(rows[0]).toMatchObject({ firstName });
  });

  test("refreshes the first name on later sign-ins", async () => {
    const t = newTest();
    await t.withIdentity(annaIdentity).mutation(api.users.ensureMe, {});
    await t
      .withIdentity({ ...annaIdentity, givenName: "Annie" })
      .mutation(api.users.ensureMe, {});

    const rows = await allUsers(t);
    expect(rows[0]).toMatchObject({ firstName: "Annie" });
  });

  test("never resets role or Trusted Lender on later sign-ins", async () => {
    const t = newTest();
    await seedViewer(t, { ...ANNA, role: "admin", trustedLender: true });
    await t.withIdentity(annaIdentity).mutation(api.users.ensureMe, {});

    const rows = await allUsers(t);
    expect(rows[0]).toMatchObject({ role: "admin", trustedLender: true });
  });

  test("ignores any role or trustedLender a Member tries to send", async () => {
    const t = newTest();
    const asAnna = t.withIdentity(annaIdentity);
    await expect(
      asAnna.mutation(api.users.ensureMe, {
        role: "admin",
        trustedLender: true,
      } as never),
    ).rejects.toThrow();
    await asAnna.mutation(api.users.ensureMe, {});

    const rows = await allUsers(t);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ role: "user", trustedLender: false });
  });

  test("fails loudly when the Clerk session token has no email claim", async () => {
    const t = newTest();
    const error = t
      .withIdentity({
        issuer: TEST_ISSUER,
        subject: ANNA.subject,
        name: ANNA.name,
      })
      .mutation(api.users.ensureMe, {});
    await expect(error).rejects.toMatchObject({
      data: {
        code: "INVALID",
        message: expect.stringContaining("Customize session token"),
      },
    });
    expect(await allUsers(t)).toHaveLength(0);
  });

  test("falls back to the first name, then the email, when there is no full name", async () => {
    const t = newTest();
    await t
      .withIdentity({ ...annaIdentity, name: undefined, givenName: "Anna" })
      .mutation(api.users.ensureMe, {});
    await t
      .withIdentity({
        issuer: TEST_ISSUER,
        subject: "user_noname",
        email: "noname@example.com",
      })
      .mutation(api.users.ensureMe, {});

    const names = (await allUsers(t)).map((u) => u.name).sort();
    expect(names).toEqual(["Anna", "noname@example.com"]);
  });
});

describe("users.me", () => {
  test("is null for a signed-out visitor", async () => {
    const t = newTest();
    expect(await t.query(api.users.me, {})).toBeNull();
  });

  test("is null until ensureMe has created the row", async () => {
    const t = newTest();
    expect(
      await t.withIdentity(annaIdentity).query(api.users.me, {}),
    ).toBeNull();
  });

  test("returns the caller's profile without the token identifier", async () => {
    const t = newTest();
    const asAnna = t.withIdentity(annaIdentity);
    await asAnna.mutation(api.users.ensureMe, {});

    const me = await asAnna.query(api.users.me, {});
    expect(me).toEqual({
      _id: expect.any(String),
      name: "Anna Lee",
      email: "anna@example.com",
      role: "user",
      trustedLender: false,
    });
  });
});

describe("users.promote", () => {
  test("is an internal function, not callable by clients", () => {
    expect(
      (users.promote as unknown as { isInternal: boolean }).isInternal,
    ).toBe(true);
  });

  test("makes the Member with that email an Admin", async () => {
    const t = newTest();
    const { as } = await seedViewer(t, ANNA);

    await t.mutation(internal.users.promote, { email: " ANNA@example.com " });

    expect(await as.query(api.users.me, {})).toMatchObject({ role: "admin" });
  });

  test("promotes the signed-in account even when an older row shares its email", async () => {
    const t = newTest();
    await seedViewer(t, { ...ANNA, subject: "user_anna_deleted" });
    const { as } = await seedViewer(t, ANNA);

    await t.mutation(internal.users.promote, { email: ANNA.email });

    expect(await as.query(api.users.me, {})).toMatchObject({ role: "admin" });
  });

  test("rejects an email that has not signed in yet with NOT_FOUND", async () => {
    const t = newTest();
    await expect(
      t.mutation(internal.users.promote, { email: "nobody@example.com" }),
    ).rejects.toMatchObject({ data: { code: "NOT_FOUND" } });
  });
});
