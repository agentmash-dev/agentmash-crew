#!/usr/bin/env node
// Lints agents/*.md against the crew authoring standard.
// Usage: node scripts/lint-agents.mjs   (exit 1 on any error)
import { readFileSync, readdirSync } from "node:fs";
import { join, dirname, basename } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const FIELDS = ["name", "description", "tools", "model", "effort", "maxTurns", "color", "skills"];
const COLORS = new Set(["red", "blue", "green", "yellow", "purple", "orange", "pink", "cyan"]);
const MODELS = new Set(["inherit", "sonnet", "opus", "haiku", "fable"]);
const EFFORTS = new Set(["low", "medium", "high", "xhigh", "max"]);
const TOOLS = new Set(["Read", "Write", "Edit", "Bash", "Grep", "Glob", "WebFetch", "WebSearch", "Agent", "NotebookEdit", "TodoWrite"]);
const CREW = new Set(["mash-coordinator", "tally-planner", "scout-explorer", "flex-frontend", "pipe-backend", "swipe-mobile", "index-database", "patch-integrations", "batch-ml", "spell-prompts", "lingo-i18n", "probe-qa", "gavel-reviewer", "snag-debugger", "prune-refactor", "bump-dependencies", "rail-cicd", "quill-docs"]);
const HEADINGS = ["## Crew protocol", "## Scope", "## Inputs", "## Process", "## Domain pitfalls", "## Rationalizations to reject", "## Definition of done", "## Stop and escalate", "## Report"];
const TOKENS = ["STATUS:", ".agentmash-crew/reports/"];
let errors = 0, warnings = 0;
const err = (f, m) => { errors++; console.log(`✗ ${f}: ${m}`); };
const warn = (f, m) => { warnings++; console.log(`! ${f}: ${m}`); };

function frontmatter(src) {
  const m = src.match(/^---\n([\s\S]*?)\n---\n/);
  if (!m) return null;
  const out = {}; let key = null;
  for (const line of m[1].split("\n")) {
    const kv = line.match(/^([A-Za-z]+):\s*(.*)$/);
    if (kv) { key = kv[1]; out[key] = kv[2].replace(/^"(.*)"$/, "$1"); continue; }
    const item = line.match(/^\s+-\s+(.*)$/);
    if (item && key) { out[key] = Array.isArray(out[key]) ? [...out[key], item[1]] : [item[1]]; }
  }
  return { data: out, body: src.slice(m[0].length) };
}

const files = readdirSync(join(root, "agents")).filter((f) => f.endsWith(".md")).sort();
for (const n of CREW) if (!files.includes(`${n}.md`)) warn("agents/", `missing agent file ${n}.md`);
for (const f of files) {
  const src = readFileSync(join(root, "agents", f), "utf8");
  const fm = frontmatter(src);
  if (!fm) { err(f, "missing frontmatter"); continue; }
  const d = fm.data;
  const keys = Object.keys(d);
  if (keys.join(",") !== FIELDS.join(",")) err(f, `frontmatter fields/order ${keys.join(",")} != ${FIELDS.join(",")}`);
  if (d.name !== basename(f, ".md")) err(f, `name ${d.name} does not match file name`);
  if (!/^[a-z][a-z0-9-]+$/.test(d.name || "")) err(f, "name is not kebab-case");
  const desc = d.description || "";
  if (desc.length < 250 || desc.length > 480) err(f, `description length ${desc.length} not in 250-480`);
  if (!/^Use (when|after)/.test(desc)) err(f, "description must start with 'Use when' or 'Use after'");
  if (!/Not for/.test(desc)) err(f, "description has no 'Not for' clause");
  const mentioned = [...desc.matchAll(/\b((?:mash|tally|scout|flex|pipe|swipe|index|patch|batch|spell|lingo|probe|gavel|snag|prune|bump|rail|quill)-[a-z0-9-]+)\b/g)].map((m) => m[1]);
  for (const s of mentioned) if (!CREW.has(s)) err(f, `description names unknown crew agent '${s}'`);
  const notFor = desc.split(/Not for/)[1] || "";
  if (!/(mash|tally|scout|flex|pipe|swipe|index|patch|batch|spell|lingo|probe|gavel|snag|prune|bump|rail|quill)-/.test(notFor)) err(f, "'Not for' clause names no sibling agent");
  for (const t of (d.tools || "").split(",").map((s) => s.trim()).filter(Boolean)) if (!TOOLS.has(t)) err(f, `unknown tool ${t}`);
  if (!MODELS.has(d.model)) err(f, `model ${d.model}`);
  if (!EFFORTS.has(d.effort)) err(f, `effort ${d.effort}`);
  if (!COLORS.has(d.color)) err(f, `color ${d.color}`);
  if (!(Number(d.maxTurns) > 0)) err(f, "maxTurns must be a positive integer");
  if (!Array.isArray(d.skills) || !d.skills.includes("crew-protocol")) err(f, "skills must include crew-protocol");
  let last = -1;
  for (const h of HEADINGS) {
    const i = fm.body.indexOf(`\n${h}\n`);
    if (i < 0) err(f, `missing heading '${h}'`);
    else if (i < last) err(f, `heading '${h}' out of order`);
    else last = i;
  }
  if (!/\*\*Iron law:\*\*/.test(fm.body)) err(f, "missing **Iron law:**");
  const hasBlock = fm.body.includes("<!-- crew-protocol:summary:start -->") && fm.body.includes("<!-- crew-protocol:summary:end -->");
  if (!hasBlock && !fm.body.includes("<!-- CREW-PROTOCOL-SUMMARY -->")) err(f, "missing crew protocol summary marker");
  for (const t of TOKENS) if (!fm.body.includes(t)) err(f, `missing token ${t}`);
  if (/—/.test(src)) warn(f, "contains em dash");
  const bodyNoBlock = fm.body.replace(/<!-- crew-protocol:summary:start -->[\s\S]*?<!-- crew-protocol:summary:end -->/, "");
  const words = bodyNoBlock.split(/\s+/).filter(Boolean).length;
  if (words < 1000 || words > 1900) warn(f, `body ${words} words (target 1100-1800)`);
  const readOnly = !/\b(Edit)\b/.test(d.tools || "");
  if (readOnly && /\buse (the )?Edit\b/i.test(fm.body)) warn(f, "read-only agent mentions using Edit");
}
console.log(`\n${files.length} agents · ${errors} errors · ${warnings} warnings`);
process.exit(errors ? 1 : 0);
