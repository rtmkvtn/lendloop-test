// npm run reset: wipes every LendLoop table, then re-runs the base seed.
import { convex, die, loadDotEnv } from "./lib.mjs";

loadDotEnv();
const result = await convex(["run", "seed:reset"], {
  timeoutMs: 60_000,
  quiet: true,
});
if (!result.ok) die(`Reset failed:\n${result.output.trim()}`);
console.log(`✔ LendLoop data wiped and demo data re-seeded
  Signed-in Members get a fresh account on their next page load; run
  npm run demo -- <email> again to set yours up.`);
