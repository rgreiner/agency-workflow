/**
 * Gera scripts/seed-clickup.bundle.mjs: injeta os dados do CSV (só os campos que
 * usamos) no template, produzindo um seed self-contained (sem CSV em runtime).
 *
 * Uso: node scripts/build-seed-bundle.mjs [caminho.csv]
 */
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dir = dirname(fileURLToPath(import.meta.url));
const CSV_PATH = process.argv[2] ?? "/Users/rafaelgreiner/Downloads/37007557HDtdjQb3.csv";

const USED = [
  "Task Name", "Task Content", "Status", "List Name",
  "Folder Name/Path", "Assignees", "Start Date Text",
  "Due Date Text", "Priority", "Date Created Text",
];

function parseCSV(text) {
  const rows = []; let row = []; let field = ""; let inQ = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQ) {
      if (c === '"') { if (text[i + 1] === '"') { field += '"'; i++; } else inQ = false; }
      else field += c;
    } else {
      if (c === '"') inQ = true;
      else if (c === ",") { row.push(field); field = ""; }
      else if (c === "\r") { /* skip */ }
      else if (c === "\n") { row.push(field); rows.push(row); row = []; field = ""; }
      else field += c;
    }
  }
  if (field.length > 0 || row.length > 0) { row.push(field); rows.push(row); }
  if (rows[0]?.[0]) rows[0][0] = rows[0][0].replace(/^﻿/, "");
  return rows;
}

const rows = parseCSV(readFileSync(CSV_PATH, "utf-8"));
const header = rows[0];
const records = rows.slice(1)
  .filter((r) => r.length > 1 || (r[0] ?? "").trim() !== "")
  .map((r) => {
    const o = {};
    for (const k of USED) o[k] = r[header.indexOf(k)] ?? "";
    return o;
  });

const template = readFileSync(join(__dir, "seed-clickup.bundle.template.mjs"), "utf-8");
const json = JSON.stringify(records, null, 0);
const out = template.replace("/*__RECORDS__*/ []", `/*__RECORDS__*/ ${json}`);

const dest = join(__dir, "seed-clickup.bundle.mjs");
writeFileSync(dest, out, "utf-8");
console.log(`✓ Gerado ${dest}`);
console.log(`  ${records.length} registros | ${(out.length / 1024).toFixed(0)} KB`);
