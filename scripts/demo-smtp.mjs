// npm run demo:break-smtp / demo:fix-smtp: re-imports n8n's credentials with
// the SMTP port pointed at a dead port (1026) or back at Mailpit's (1025), so a
// reviewer can watch email failures surface. Credentials are read from the
// database on every run, so the running n8n picks the change up at once.
import { spawnSync } from "node:child_process";
import { die } from "./lib.mjs";

export const DEAD_PORT = "1026";

export function setSmtpPort(port) {
  const script = [
    "set -eu",
    "umask 077",
    `SMTP_PORT=${port} node /opt/lendloop/render.cjs /opt/lendloop/credentials.template.json /tmp/creds.json`,
    "n8n import:credentials --input=/tmp/creds.json >/dev/null",
    "rm -f /tmp/creds.json",
  ].join("\n");
  const res = spawnSync(
    "docker",
    ["compose", "exec", "-T", "-u", "node", "n8n", "sh", "-c", script],
    { encoding: "utf8" },
  );
  if (res.status !== 0) {
    die(
      `Could not update the SMTP credential. Is the stack up?\n${res.stderr}`,
    );
  }
}

const mode = process.argv[2];
if (mode === "break") {
  setSmtpPort(DEAD_PORT);
  console.log(
    `✔ SMTP now points at mailpit:${DEAD_PORT}, where nothing listens. Emails will fail.\n` +
      "  Watch: a Request's activity line turns red, Admin → Automation health lists it.\n" +
      "  Undo with `npm run demo:fix-smtp`.",
  );
} else if (mode === "fix") {
  setSmtpPort("1025");
  console.log("✔ SMTP points at Mailpit again (mailpit:1025).");
} else if (mode !== undefined) {
  die("Usage: node scripts/demo-smtp.mjs break|fix");
}
