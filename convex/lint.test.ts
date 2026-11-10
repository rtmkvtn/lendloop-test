// @vitest-environment node
import { ESLint } from "eslint";
import { describe, expect, test } from "vitest";

const eslint = new ESLint({ cwd: process.cwd() });

async function restrictedImportErrors(code: string, filePath: string) {
  const [result] = await eslint.lintText(code, { filePath });
  return (result?.messages ?? []).filter(
    (m) => m.ruleId === "no-restricted-imports",
  );
}

describe("raw Convex function builders", () => {
  test.each([
    ['import { query } from "./_generated/server";', "convex/sample.ts"],
    [
      'import { mutation } from "../_generated/server";',
      "convex/lib/sample.ts",
    ],
    [
      'import { internalMutation } from "./_generated/server";',
      "convex/sample.ts",
    ],
    ['import { httpAction } from "./_generated/server";', "convex/sample.ts"],
    ['import { queryGeneric } from "convex/server";', "convex/sample.ts"],
  ])("are banned outside the wrapper module: %s", async (code, filePath) => {
    expect(await restrictedImportErrors(code, filePath)).toHaveLength(1);
  });

  test("are allowed inside convex/lib/functions.ts", async () => {
    expect(
      await restrictedImportErrors(
        'import { query } from "../_generated/server";',
        "convex/lib/functions.ts",
      ),
    ).toHaveLength(0);
  });

  test("leave types and the wrapper module itself importable", async () => {
    expect(
      await restrictedImportErrors(
        'import type { QueryCtx } from "./_generated/server";\nimport { memberQuery } from "./lib/functions";',
        "convex/sample.ts",
      ),
    ).toHaveLength(0);
  });
});
