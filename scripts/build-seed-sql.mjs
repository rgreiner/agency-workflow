/**
 * Gera scripts/seed-clickup.sql — SEED idempotente em SQL puro, com os hashes
 * de senha (scrypt, mesmo formato do app) já calculados. Pensado pra aplicar via
 * psql dentro do container do Postgres do Flow (padrão do CRM no SSH root).
 *
 * Uso: node scripts/build-seed-sql.mjs [caminho.csv]
 */
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { scrypt, randomBytes } from "node:crypto";
import { promisify } from "node:util";

const scryptAsync = promisify(scrypt);
const __dir = dirname(fileURLToPath(import.meta.url));
const CSV_PATH = process.argv[2] ?? "/Users/rafaelgreiner/Downloads/37007557HDtdjQb3.csv";

const ORG_NAME = "One a One";
const ORG_SLUG = "one-a-one";
const EMAIL_DOMAIN = "oneaone.com.br";
const SEED_PASSWORD = process.env.SEED_PASSWORD ?? "teste1234";
const OWNER_NAME = "Rafael Greiner";

const STATUS_MAP = {
  "fechado": "concluido", "concluido": "concluido", "design": "design",
  "pendente do cliente": "pendente_cliente", "pendente": "briefing", "mídia": "midia",
  "aprovação do cliente": "aprovacao_cliente", "implantação off/orgânico": "implantacao_off",
  "edição": "edicao", "produção fornecedores": "producao_fornecedores", "insight": "insight",
  "revisão interna": "revisao_interna", "redação": "redacao", "validação do atendimento": "validacao_atendimento",
};
const STATUS_FALLBACK = "briefing";
const PRIORITY_MAP = { "1": "urgent", "2": "high", "3": "medium", "4": "low" };

async function hashSenha(senha) {
  const salt = randomBytes(16).toString("hex");
  const derivado = await scryptAsync(senha, salt, 64);
  return `${salt}:${derivado.toString("hex")}`;
}
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
const stripAccents = (s) => s.normalize("NFD").replace(/[̀-ͯ]/g, "");
function parseDate(s) {
  s = (s ?? "").trim();
  if (!s || s === "null") return null;
  const m = s.match(/(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (!m) return null;
  const [, mo, d, y] = m;
  return `${y}-${mo.padStart(2, "0")}-${d.padStart(2, "0")}`;
}
function cleanTitle(name) { const t = (name ?? "").trim(); const m = t.match(/^\d{6}\s*-\s*(.+)$/); return (m ? m[1] : t).trim() || t; }
function cleanContent(s) { s = (s ?? "").trim(); if (!s || s === "null") return null; return s.replace(/\\n/g, "\n").replace(/\\t/g, "\t"); }

// SQL helpers
const q = (s) => (s === null || s === undefined ? "null" : `'${String(s).replace(/'/g, "''")}'`);
const date = (s) => (s ? `${q(s)}::date` : "null");
const ts = (s) => (s ? `${q(s)}::timestamptz` : "null");

const rows = parseCSV(readFileSync(CSV_PATH, "utf-8"));
const header = rows[0];
const recs = rows.slice(1).filter((r) => r.length > 1 || (r[0] ?? "").trim() !== "")
  .map((r) => Object.fromEntries(header.map((h, i) => [h, r[i] ?? ""])));

// usuários + e-mails
const nameCounts = new Map(); const allNames = new Set();
for (const r of recs) for (const n of parseArr(r["Assignees"])) allNames.add(n);
for (const n of allNames) { const f = stripAccents(n.trim().split(/\s+/)[0]).toLowerCase(); if (!nameCounts.has(f)) nameCounts.set(f, new Set()); nameCounts.get(f).add(n); }
function emailFor(name) {
  const parts = name.trim().split(/\s+/);
  const first = stripAccents(parts[0]).toLowerCase().replace(/[^a-z0-9]/g, "");
  const collides = (nameCounts.get(first)?.size ?? 0) > 1;
  let local = first;
  if (collides && parts[1]) local = `${first}.${stripAccents(parts[1]).toLowerCase().replace(/[^a-z0-9]/g, "")}`;
  return `${local}@${EMAIL_DOMAIN}`;
}
const ownerEmail = emailFor(OWNER_NAME);
const folderOf = (r) => (parseArr(r["Folder Name/Path"])[0] ?? "Sem cliente").trim();
const clients = [...new Set(recs.map(folderOf))];
const campaignKeys = [...new Set(recs.map((r) => `${folderOf(r)}|||${r["List Name"].trim()}`))];

const OWNER = `(select id from auth.users where lower(email)=lower(${q(ownerEmail)}))`;
const ORG = `(select id from organizations where slug=${q(ORG_SLUG)})`;

const L = [];
L.push("-- Seed ClickUp → Flow (idempotente). Gerado por build-seed-sql.mjs.");
L.push("begin;");
L.push("");
L.push("-- organização (reutiliza se já existir)");
L.push(`insert into organizations (name, slug, plan, max_members)`);
L.push(`select ${q(ORG_NAME)}, ${q(ORG_SLUG)}, 'pro', 100`);
L.push(`where not exists (select 1 from organizations where slug=${q(ORG_SLUG)});`);
L.push("");

L.push("-- usuários (auth.users → trigger cria profile) + membership");
const users = [...allNames];
for (const name of users) {
  const email = emailFor(name);
  const role = name.trim().toLowerCase() === OWNER_NAME.toLowerCase() ? "owner" : "member";
  const hash = await hashSenha(SEED_PASSWORD);
  L.push(`insert into auth.users (email, encrypted_password, raw_user_meta_data)`);
  L.push(`select ${q(email)}, ${q(hash)}, jsonb_build_object('full_name', ${q(name)})`);
  L.push(`where not exists (select 1 from auth.users where lower(email)=lower(${q(email)}));`);
  L.push(`insert into organization_members (org_id, user_id, role)`);
  L.push(`select ${ORG}, u.id, ${q(role)} from auth.users u where lower(u.email)=lower(${q(email)})`);
  L.push(`and not exists (select 1 from organization_members m where m.org_id=${ORG} and m.user_id=u.id);`);
}
L.push("");

L.push("-- clientes (workspaces)");
for (const c of clients) {
  L.push(`insert into workspaces (org_id, name, created_by)`);
  L.push(`select ${ORG}, ${q(c)}, ${OWNER}`);
  L.push(`where not exists (select 1 from workspaces w where w.org_id=${ORG} and w.name=${q(c)});`);
}
L.push("");

L.push("-- campanhas");
for (const key of campaignKeys) {
  const [folder, list] = key.split("|||");
  const WS = `(select id from workspaces where org_id=${ORG} and name=${q(folder)})`;
  L.push(`insert into campaigns (workspace_id, name, created_by)`);
  L.push(`select ${WS}, ${q(list)}, ${OWNER}`);
  L.push(`where ${WS} is not null and not exists (select 1 from campaigns c where c.workspace_id=${WS} and c.name=${q(list)});`);
}
L.push("");

L.push("-- atividades + responsáveis");
recs.forEach((r, i) => {
  const folder = folderOf(r), list = r["List Name"].trim();
  const title = cleanTitle(r["Task Name"]);
  const status = STATUS_MAP[r["Status"].trim().toLowerCase()] ?? STATUS_FALLBACK;
  const priority = PRIORITY_MAP[(r["Priority"] ?? "").trim()] ?? "medium";
  const desc = cleanContent(r["Task Content"]);
  const start = parseDate(r["Start Date Text"]);
  const due = parseDate(r["Due Date Text"]);
  const created = parseDate(r["Date Created Text"]);
  const CAMP = `(select c.id from campaigns c join workspaces w on w.id=c.workspace_id where w.org_id=${ORG} and w.name=${q(folder)} and c.name=${q(list)})`;
  L.push(`insert into activities (campaign_id, title, description, status, priority, start_date, due_date, sort_order, created_by, created_at)`);
  L.push(`select ${CAMP}, ${q(title)}, ${q(desc)}, ${q(status)}::activity_status, ${q(priority)}::activity_priority, ${date(start)}, ${ts(due)}, ${i}, ${OWNER}, ${created ? ts(created) : "now()"}`);
  L.push(`where ${CAMP} is not null and not exists (select 1 from activities a where a.campaign_id=${CAMP} and a.title=${q(title)});`);
  for (const name of parseArr(r["Assignees"])) {
    const email = emailFor(name);
    L.push(`insert into activity_assignees (activity_id, user_id)`);
    L.push(`select a.id, u.id from activities a join campaigns c on c.id=a.campaign_id join workspaces w on w.id=c.workspace_id, auth.users u`);
    L.push(`where w.org_id=${ORG} and w.name=${q(folder)} and c.name=${q(list)} and a.title=${q(title)} and lower(u.email)=lower(${q(email)})`);
    L.push(`and not exists (select 1 from activity_assignees aa where aa.activity_id=a.id and aa.user_id=u.id);`);
  }
});
L.push("");
L.push("commit;");

const dest = join(__dir, "seed-clickup.sql");
writeFileSync(dest, L.join("\n") + "\n", "utf-8");
console.log(`✓ Gerado ${dest}`);
console.log(`  ${recs.length} tarefas | ${users.length} usuários | ${clients.length} clientes | ${campaignKeys.length} campanhas`);
