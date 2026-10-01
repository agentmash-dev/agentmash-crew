#!/usr/bin/env node
// Lints agents/*.md against the crew authoring standard, adapted for the lab: lab-protocol instead of crew-protocol,
// and sibling agents may be lab or crew agents.
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
const LAB = new Set(["hunch-hypotheses", "seal-prereg", "atlas-curator", "bench-analyst", "foil-controls", "assay-judge", "volt-ieee", "ribbon-isef", "tensor-mlconf", "proof-journal"]);
const CREW = new Set(["mash-coordinator", "tally-planner", "scout-explorer", "flex-frontend", "pipe-backend", "swipe-mobile", "index-database", "patch-integrations", "batch-ml", "spell-prompts", "lingo-i18n", "probe-qa", "gavel-reviewer", "snag-debugger", "prune-refactor", "bump-dependencies", "rail-cicd", "quill-docs", "higgs-video", "plain-editor", "tempo-motion", "inspo-scrap"]);
const KNOWN = new Set([...LAB, ...CREW]);
const SIBLING = /\b((?:hunch|seal|atlas|bench|foil|assay|volt|ribbon|tensor|proof|mash|tally|scout|flex|pipe|swipe|index|patch|batch|spell|lingo|probe|gavel|snag|prune|bump|rail|quill|higgs|plain|tempo|inspo)-[a-z0-9-]+)\b/g;
const HEADINGS = ["## Lab protocol", "## Scope", "## Inputs", "## Process", "## Domain pitfalls", "## Rationalizations to reject", "## Definition of done", "## Stop and escalate", "## Report"];
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
for (const n of LAB) if (!files.includes(`${n}.md`)) err("agents/", `missing agent file ${n}.md`);
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
  if (!LAB.has(d.name)) err(f, `${d.name} is not in the lab roster`);
  const mentioned = [...desc.matchAll(SIBLING)].map((m) => m[1]);
  for (const s of mentioned) if (!KNOWN.has(s)) err(f, `description names unknown agent '${s}'`);
  const notFor = desc.split(/Not for/)[1] || "";
  if (![...notFor.matchAll(SIBLING)].some((m) => KNOWN.has(m[1]))) err(f, "'Not for' clause names no sibling agent");
  for (const t of (d.tools || "").split(",").map((s) => s.trim()).filter(Boolean)) if (!TOOLS.has(t)) err(f, `unknown tool ${t}`);
  if (!MODELS.has(d.model)) err(f, `model ${d.model}`);
  if (!EFFORTS.has(d.effort)) err(f, `effort ${d.effort}`);
  if (!COLORS.has(d.color)) err(f, `color ${d.color}`);
  if (!(Number(d.maxTurns) > 0)) err(f, "maxTurns must be a positive integer");
  if (!Array.isArray(d.skills) || !d.skills.includes("lab-protocol")) err(f, "skills must include lab-protocol");
  let last = -1;
  for (const h of HEADINGS) {
    const i = fm.body.indexOf(`\n${h}\n`);
    if (i < 0) err(f, `missing heading '${h}'`);
    else if (i < last) err(f, `heading '${h}' out of order`);
    else last = i;
  }
  if (!/\*\*Iron law:\*\*/.test(fm.body)) err(f, "missing **Iron law:**");
  const hasBlock = fm.body.includes("<!-- lab-protocol:summary:start -->") && fm.body.includes("<!-- lab-protocol:summary:end -->");
  if (!hasBlock) err(f, "missing lab protocol summary markers");
  for (const t of TOKENS) if (!fm.body.includes(t)) err(f, `missing token ${t}`);
  if (/—/.test(src)) warn(f, "contains em dash");
  const bodyNoBlock = fm.body.replace(/<!-- lab-protocol:summary:start -->[\s\S]*?<!-- lab-protocol:summary:end -->/, "");
  const words = bodyNoBlock.split(/\s+/).filter(Boolean).length;
  if (words < 1000 || words > 1900) warn(f, `body ${words} words (target 1100-1800)`);
  const readOnly = !/\b(Edit)\b/.test(d.tools || "");
  if (readOnly && /\buse (the )?Edit\b/i.test(fm.body)) warn(f, "read-only agent mentions using Edit");
}
console.log(`\n${files.length} agents · ${errors} errors · ${warnings} warnings`);
process.exit(errors ? 1 : 0);
