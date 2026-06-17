/**
 * Gera scripts/seed-fix-titles.sql — restaura o NOME COMPLETO (com a data
 * "YYMMDD - ...") das atividades importadas, que tinham sido encurtadas no seed.
 * Faz UPDATE em quem ainda está com o título sem prefixo (idempotente).
 *
 * Uso: node scripts/build-fix-titles-sql.mjs [caminho.csv]
 */
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dir = dirname(fileURLToPath(import.meta.url));
const CSV_PATH = process.argv[2] ?? "/Users/rafaelgreiner/Downloads/37007557HDtdjQb3.csv";
const ORG_SLUG = "one-a-one";

function parseCSV(text) {
  const rows = []; let row = []; let field = ""; let inQ = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQ) { if (c === '"') { if (text[i + 1] === '"') { field += '"'; i++; } else inQ = false; } else field += c; }
    else { if (c === '"') inQ = true; else if (c === ",") { row.push(field); field = ""; } else if (c === "\r") {} else if (c === "\n") { row.push(field); rows.push(row); row = []; field = ""; } else field += c; }
  }
  if (field.length > 0 || row.length > 0) { row.push(field); rows.push(row); }
  if (rows[0]?.[0]) rows[0][0] = rows[0][0].replace(/^﻿/, "");
  return rows;
}
function parseArr(s) {
  s = (s ?? "").trim();
  if (!s || s === "[]" || s === "null") return [];
  return s.replace(/^\[|\]$/g, "").split(",").map((p) => p.trim().replace(/^"|"$/g, "").trim()).filter(Boolean);
}
const fullTitle = (name) => (name ?? "").trim();
const strippedTitle = (name) => {
  const t = (name ?? "").trim();
  const m = t.match(/^\d{6}\s*-\s*(.+)$/);
  return (m ? m[1] : t).trim() || t;
};
const q = (s) => `'${String(s).replace(/'/g, "''")}'`;
const folderOf = (r) => (parseArr(r["Folder Name/Path"])[0] ?? "Sem cliente").trim();

const rows = parseCSV(readFileSync(CSV_PATH, "utf-8"));
const header = rows[0];
const recs = rows.slice(1)
  .filter((r) => r.length > 1 || (r[0] ?? "").trim() !== "")
  .map((r) => Object.fromEntries(header.map((h, i) => [h, r[i] ?? ""])));

const L = [];
L.push("-- Restaura o nome completo (com data) das atividades importadas. Idempotente.");
L.push("begin;");
let n = 0;
for (const r of recs) {
  const full = fullTitle(r["Task Name"]);
  const stripped = strippedTitle(r["Task Name"]);
  if (full === stripped) continue; // não havia prefixo de data
  const client = folderOf(r);
  const list = r["List Name"].trim();
  L.push(
    `update activities a set title = ${q(full)} ` +
    `from campaigns c join workspaces w on w.id = c.workspace_id join organizations o on o.id = w.org_id ` +
    `where c.id = a.campaign_id and o.slug = ${q(ORG_SLUG)} and w.name = ${q(client)} and c.name = ${q(list)} and a.title = ${q(stripped)};`
  );
  n++;
}
L.push("commit;");

writeFileSync(join(__dir, "seed-fix-titles.sql"), L.join("\n") + "\n", "utf-8");
console.log(`✓ seed-fix-titles.sql — ${n} updates`);
