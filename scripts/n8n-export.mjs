// npm run n8n:export: pulls the workflows out of the running n8n container,
// normalises them into n8n/workflows/, then scans for anything secret-shaped.
// `--check` only runs the scan (part of `npm run check`).
import { spawnSync } from "node:child_process";
import {
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { die } from "./lib.mjs";

const WORKFLOWS = "n8n/workflows";
const TEMPLATE = "n8n/credentials.template.json";
const SECRET_KEYS =
  /^(hmacSecret|password|secret|apiKey|token|privateKey|accessToken)$/i;
const HEX = /\b[0-9a-f]{32,}\b/i;
const BASE64 = /[A-Za-z0-9+/]{40,}={0,2}/;
const PLACEHOLDER = /^\$\{[A-Z0-9_]+\}$/;

function sh(cmd, args) {
  const res = spawnSync(cmd, args, { encoding: "utf8" });
  if (res.status !== 0) die(`${cmd} ${args.join(" ")} failed:\n${res.stderr}`);
  return res.stdout;
}

function normalise(wf) {
  return {
    id: wf.id,
    name: wf.name,
    active: false,
    settings: wf.settings ?? {},
    nodes: wf.nodes.map(
      ({ id, name, type, typeVersion, position, parameters, ...rest }) => {
        const node = { id, name, type, typeVersion, position, parameters };
        for (const key of [
          "webhookId",
          "credentials",
          "retryOnFail",
          "maxTries",
          "waitBetweenTries",
          "onError",
          "alwaysOutputData",
          "executeOnce",
          "notes",
          "disabled",
        ]) {
          if (rest[key] !== undefined) node[key] = rest[key];
        }
        if (node.credentials) {
          node.credentials = Object.fromEntries(
            Object.entries(node.credentials).map(([k, c]) => [
              k,
              { id: c.id, name: c.name },
            ]),
          );
        }
        return node;
      },
    ),
    connections: wf.connections,
  };
}

function exportFromContainer() {
  const inContainer = "/tmp/lendloop-export";
  sh("docker", [
    "compose",
    "exec",
    "-T",
    "-u",
    "node",
    "n8n",
    "rm",
    "-rf",
    inContainer,
  ]);
  sh("docker", [
    "compose",
    "exec",
    "-T",
    "-u",
    "node",
    "n8n",
    "n8n",
    "export:workflow",
    "--all",
    "--separate",
    `--output=${inContainer}/`,
  ]);
  const local = mkdtempSync(join(tmpdir(), "lendloop-export-"));
  try {
    sh("docker", ["compose", "cp", `n8n:${inContainer}/.`, local]);
    const existing = new Map(
      readdirSync(WORKFLOWS)
        .filter((f) => f.endsWith(".json"))
        .map((f) => [
          JSON.parse(readFileSync(join(WORKFLOWS, f), "utf8")).id,
          f,
        ]),
    );
    // entrypoint.sh rendered the alert address in; put the placeholder back.
    const alertEmail = sh("docker", [
      "compose",
      "exec",
      "-T",
      "n8n",
      "printenv",
      "ADMIN_ALERT_EMAIL",
    ]).trim();
    for (const file of readdirSync(local).filter((f) => f.endsWith(".json"))) {
      const wf = normalise(JSON.parse(readFileSync(join(local, file), "utf8")));
      const target = existing.get(wf.id) ?? `${wf.id}.json`;
      let text = JSON.stringify(wf, null, 2) + "\n";
      if (alertEmail) {
        text = text.replaceAll(
          JSON.stringify(alertEmail),
          '"${ADMIN_ALERT_EMAIL}"',
        );
      }
      writeFileSync(join(WORKFLOWS, target), text);
      console.log(`✔ exported ${wf.name} → ${WORKFLOWS}/${target}`);
    }
  } finally {
    rmSync(local, { recursive: true, force: true });
  }
}

function walk(value, path, visit) {
  visit(value, path);
  if (value && typeof value === "object") {
    for (const [k, v] of Object.entries(value)) walk(v, [...path, k], visit);
  }
}

function scanWorkflow(wf, file) {
  const problems = [];
  walk(wf, [], (value, path) => {
    const key = path.at(-1);
    const where = `${file}: ${path.join(".")}`;
    if (typeof key === "string" && SECRET_KEYS.test(key)) {
      problems.push(`${where} is a secret-shaped key`);
    }
    if (typeof value === "string") {
      if (HEX.test(value) || BASE64.test(value)) {
        problems.push(`${where} holds a secret-shaped value`);
      }
      if (/\$env\b/.test(value)) problems.push(`${where} reads $env`);
    }
  });
  for (const node of wf.nodes ?? []) {
    if (node.type === "n8n-nodes-base.crypto" && node.typeVersion !== 2) {
      problems.push(
        `${file}: Crypto node "${node.name}" must be typeVersion 2`,
      );
    }
    for (const [type, ref] of Object.entries(node.credentials ?? {})) {
      const keys = Object.keys(ref).sort().join(",");
      if (keys !== "id,name") {
        problems.push(
          `${file}: "${node.name}" credential ${type} must hold only {id, name}`,
        );
      }
    }
  }
  return problems;
}

function scanTemplate(text) {
  const problems = [];
  const rendered = JSON.parse(text.replace(/\$\{SMTP_PORT\}/g, "1025"));
  walk(rendered, [], (value, path) => {
    const key = path.at(-1);
    if (
      typeof key === "string" &&
      SECRET_KEYS.test(key) &&
      typeof value === "string"
    ) {
      if (value !== "" && !PLACEHOLDER.test(value)) {
        problems.push(
          `${TEMPLATE}: ${path.join(".")} must be a \${VAR} placeholder`,
        );
      }
    }
  });
  return problems;
}

function scan() {
  const problems = [];
  for (const file of readdirSync(WORKFLOWS).filter((f) =>
    f.endsWith(".json"),
  )) {
    const path = join(WORKFLOWS, file);
    problems.push(
      ...scanWorkflow(JSON.parse(readFileSync(path, "utf8")), path),
    );
  }
  problems.push(...scanTemplate(readFileSync(TEMPLATE, "utf8")));
  if (problems.length > 0)
    die(`n8n secret scan failed:\n  ${problems.join("\n  ")}`);
  console.log("✔ n8n workflows and credentials template are free of secrets");
}

if (!process.argv.includes("--check")) exportFromContainer();
scan();
