#!/usr/bin/env node
// Inserts skills/lab-protocol/summary.md into every lab agent under "## Lab protocol".
// Idempotent: replaces the block between the start/end markers.
// Usage: node scripts/sync-protocol-summary.mjs [--check]
import { readFileSync, writeFileSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const summary = readFileSync(join(root, "skills/lab-protocol/summary.md"), "utf8").trim();
const START = "<!-- lab-protocol:summary:start -->";
const END = "<!-- lab-protocol:summary:end -->";
const block = `${START}\n${summary}\n${END}`;
const check = process.argv.includes("--check");
let drift = 0;

for (const f of readdirSync(join(root, "agents")).filter((f) => f.endsWith(".md"))) {
  const path = join(root, "agents", f);
  const src = readFileSync(path, "utf8");
  let out;
  if (src.includes(START) && src.includes(END)) {
    out = src.replace(new RegExp(`${START}[\\s\\S]*?${END}`), block);
  } else {
    console.error(`✗ ${f}: no summary marker`);
    drift++;
    continue;
  }
  if (out !== src) {
    drift++;
    if (!check) writeFileSync(path, out);
    console.log(`${check ? "✗ out of date" : "✓ synced"} ${f}`);
  }
}
if (check && drift) process.exit(1);
console.log(drift ? `${check ? "drift in" : "updated"} ${drift} file(s)` : "all agents in sync");
