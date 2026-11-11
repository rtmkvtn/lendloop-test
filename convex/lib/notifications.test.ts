// @vitest-environment node
import { readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";
import { EMAIL_EVENTS } from "./notifications";

function composeCopyKeys() {
  const workflow = JSON.parse(
    readFileSync("n8n/workflows/notify.json", "utf8"),
  ) as { nodes: { name: string; parameters: { jsCode?: string } }[] };
  const code = workflow.nodes.find((n) => n.name === "Compose")?.parameters
    .jsCode;
  const table = /const copy = \{([\s\S]*?)\n\}\[b\.event\]/.exec(code ?? "");
  if (!table?.[1]) throw new Error("No copy table in the Compose node");
  return [...table[1].matchAll(/^\s*'([a-z_.]+)':/gm)].map((m) => m[1]);
}

describe("Notification emails", () => {
  test("n8n's Compose node has copy for exactly the catalogued events", () => {
    expect(composeCopyKeys().sort()).toEqual([...EMAIL_EVENTS].sort());
  });
});
