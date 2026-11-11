// Fills ${VAR} placeholders from the container env (the image has no envsubst).
const fs = require("fs");

const tpl = fs.readFileSync(process.argv[2], "utf8");
const out = tpl.replace(/\$\{([A-Z0-9_]+)\}/g, (_, name) => {
  const value = process.env[name];
  if (value === undefined || value === "") {
    console.error(`render.cjs: missing env ${name}`);
    process.exit(1);
  }
  return /^\d+$/.test(value) ? value : JSON.stringify(value).slice(1, -1);
});
JSON.parse(out);
fs.writeFileSync(process.argv[3], out, { mode: 0o600 });
