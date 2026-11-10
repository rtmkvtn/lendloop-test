import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";
import convexPlugin from "@convex-dev/eslint-plugin";
import prettier from "eslint-config-prettier/flat";

const RAW_BUILDERS = [
  "query",
  "mutation",
  "action",
  "internalQuery",
  "internalMutation",
  "internalAction",
  "httpAction",
];
const RAW_GENERIC_BUILDERS = [
  "queryGeneric",
  "mutationGeneric",
  "actionGeneric",
  "internalQueryGeneric",
  "internalMutationGeneric",
  "internalActionGeneric",
  "httpActionGeneric",
];
const WRAPPER_MESSAGE =
  "Build Convex functions from the wrappers in convex/lib/functions.ts so access checks can't be skipped.";

export default defineConfig([
  ...nextVitals,
  ...nextTs,
  ...convexPlugin.configs.recommended,
  {
    files: ["convex/**/*.ts"],
    ignores: ["convex/lib/functions.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          paths: [
            {
              name: "convex/server",
              importNames: RAW_GENERIC_BUILDERS,
              message: WRAPPER_MESSAGE,
            },
          ],
          patterns: [
            {
              group: ["**/_generated/server"],
              importNames: RAW_BUILDERS,
              message: WRAPPER_MESSAGE,
            },
          ],
        },
      ],
    },
  },
  {
    files: ["convex/auth.config.ts", "convex/lib/env.ts"],
    rules: { "@convex-dev/no-process-env": "off" },
  },
  {
    // Run by plain `node` inside the n8n image, which is CommonJS.
    files: ["n8n/**/*.cjs"],
    rules: { "@typescript-eslint/no-require-imports": "off" },
  },
  prettier,
  globalIgnores([
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    "convex/_generated/**",
  ]),
]);
