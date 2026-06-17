/**
 * Seed de dados de teste a partir de um export do ClickUp (CSV).
 *
 * Mapeia a hierarquia do ClickUp para o nosso modelo:
 *   Space  → organization        (1 org de TESTE, isolada)
 *   Folder → workspace (cliente)
 *   List   → campaign
 *   Task   → activity
 *   Assignees → activity_assignees (+ usuários em auth.users/profiles)
 *
 * Tudo vai sob a organização ORG_SLUG (por padrão a real "one-a-one"). Se ela
 * já existe, é REUTILIZADA (sem renomear) e os dados são só ADICIONADOS.
 *
 * Uso:
 *   DATABASE_URL=postgres://... node scripts/seed-clickup.mjs [caminho.csv] [flags]
 *
 * Flags:
 *   --dry     mostra o resumo do que faria, sem gravar nada (não conecta no banco)
 *   --check   só testa a conexão (select now()) e sai — útil pra validar o túnel
 *   --reset   apaga SÓ os workspaces dos clientes deste CSV antes de re-semear
 *             (exige CONFIRM_RESET=1 — é destrutivo). NÃO mexe em outros clientes.
 *
 * Env opcionais:
 *   ORG_NAME            (default "One a One") — usado só se a org ainda não existir
 *   ORG_SLUG            (default "one-a-one") — org alvo (a real, do dashboard)
 *   EMAIL_DOMAIN        (default "oneaone.com.br")
 *   SEED_PASSWORD       (default "teste1234")  — senha de teste de TODOS os usuários
 *   OWNER_NAME          (default "Rafael Greiner") — vira role 'owner' na org
 */
import postgres from "postgres";
import { scrypt, randomBytes } from "node:crypto";
import { promisify } from "node:util";
import { readFileSync } from "node:fs";

const scryptAsync = promisify(scrypt);

// ── Config ───────────────────────────────────────────────────────────────────
const CSV_PATH =
  process.argv.slice(2).find((a) => !a.startsWith("--")) ??
  "/Users/rafaelgreiner/Downloads/37007557HDtdjQb3.csv";
const DRY = process.argv.includes("--dry");
const RESET = process.argv.includes("--reset");

const ORG_NAME = process.env.ORG_NAME ?? "One a One";
const ORG_SLUG = process.env.ORG_SLUG ?? "one-a-one";
const EMAIL_DOMAIN = process.env.EMAIL_DOMAIN ?? "oneaone.com.br";
const SEED_PASSWORD = process.env.SEED_PASSWORD ?? "teste1234";
const OWNER_NAME = process.env.OWNER_NAME ?? "Rafael Greiner";

// ClickUp status (lowercase) → nosso enum activity_status
const STATUS_MAP = {
  "fechado": "concluido",
  "concluido": "concluido",
  "design": "design",
  "pendente do cliente": "pendente_cliente",
  "pendente": "briefing",
  "mídia": "midia",
  "aprovação do cliente": "aprovacao_cliente",
  "implantação off/orgânico": "implantacao_off",
  "edição": "edicao",
  "produção fornecedores": "producao_fornecedores",
  "insight": "insight",
  "revisão interna": "revisao_interna",
  "redação": "redacao",
  "validação do atendimento": "validacao_atendimento",
};
const STATUS_FALLBACK = "briefing";

// ClickUp priority → nosso enum activity_priority (1 urgent, 2 high, 3 normal, 4 low)
const PRIORITY_MAP = { "1": "urgent", "2": "high", "3": "medium", "4": "low" };

// ── Helpers ──────────────────────────────────────────────────────────────────
async function hashSenha(senha) {
  const salt = randomBytes(16).toString("hex");
  const derivado = await scryptAsync(senha, salt, 64);
  return `${salt}:${derivado.toString("hex")}`;
}

/** Parser CSV robusto (aspas, aspas duplas escapadas, vírgulas e quebras dentro de campos). */
function parseCSV(text) {
  const rows = [];
  let row = [];
  let field = "";
  let inQ = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQ) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; }
        else inQ = false;
      } else field += c;
    } else {
      if (c === '"') inQ = true;
      else if (c === ",") { row.push(field); field = ""; }
      else if (c === "\r") { /* ignora */ }
      else if (c === "\n") { row.push(field); rows.push(row); row = []; field = ""; }
      else field += c;
    }
  }
  if (field.length > 0 || row.length > 0) { row.push(field); rows.push(row); }
  // remove BOM da 1ª célula
  if (rows[0]?.[0]) rows[0][0] = rows[0][0].replace(/^﻿/, "");
  return rows;
}

function toObjects(rows) {
  const header = rows[0];
  return rows
    .slice(1)
    .filter((r) => r.length > 1 || (r[0] ?? "").trim() !== "")
    .map((r) => Object.fromEntries(header.map((h, i) => [h, r[i] ?? ""])));
}

/** "[a,b]" / '["Go On "]' → ["a","b"] / ["Go On"] (limpa colchetes, aspas, espaços). */
function parseArr(s) {
  s = (s ?? "").trim();
  if (!s || s === "[]" || s === "null") return [];
  return s
    .replace(/^\[|\]$/g, "")
    .split(",")
    .map((p) => p.trim().replace(/^"|"$/g, "").trim())
    .filter(Boolean);
}

function stripAccents(s) {
  return s.normalize("NFD").replace(/[̀-ͯ]/g, "");
}

/** "M/D/YYYY, ..." → "YYYY-MM-DD" (ou null). */
function parseDate(s) {
  s = (s ?? "").trim();
  if (!s || s === "null") return null;
  const m = s.match(/(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (!m) return null;
  const [, mo, d, y] = m;
  return `${y}-${mo.padStart(2, "0")}-${d.padStart(2, "0")}`;
}

/** Remove o prefixo "YYMMDD - " do nome da tarefa. */
function cleanTitle(name) {
  const t = (name ?? "").trim();
  const m = t.match(/^\d{6}\s*-\s*(.+)$/);
  return (m ? m[1] : t).trim() || t;
}

/** Briefing: desfaz os \n escapados do export. */
function cleanContent(s) {
  s = (s ?? "").trim();
  if (!s || s === "null") return null;
  return s.replace(/\\n/g, "\n").replace(/\\t/g, "\t");
}

// ── Main ─────────────────────────────────────────────────────────────────────
const rows = toObjects(parseCSV(readFileSync(CSV_PATH, "utf-8")));
console.log(`📄 CSV: ${CSV_PATH} — ${rows.length} tarefas`);

// 1) Usuários distintos + resolução de e-mail (sobrenome só em colisão de 1º nome)
const nameCounts = new Map(); // primeiroNome(normalizado) → Set(nomeCompleto)
const allNames = new Set();
for (const r of rows) for (const n of parseArr(r["Assignees"])) allNames.add(n);
for (const n of allNames) {
  const first = stripAccents(n.trim().split(/\s+/)[0]).toLowerCase();
  if (!nameCounts.has(first)) nameCounts.set(first, new Set());
  nameCounts.get(first).add(n);
}
function emailFor(name) {
  const parts = name.trim().split(/\s+/);
  const first = stripAccents(parts[0]).toLowerCase().replace(/[^a-z0-9]/g, "");
  const collides = (nameCounts.get(first)?.size ?? 0) > 1;
  let local = first;
  if (collides && parts[1]) {
    local = `${first}.${stripAccents(parts[1]).toLowerCase().replace(/[^a-z0-9]/g, "")}`;
  }
  return `${local}@${EMAIL_DOMAIN}`;
}

const users = [...allNames].map((name) => ({
  name,
  email: emailFor(name),
  role: name.trim().toLowerCase() === OWNER_NAME.toLowerCase() ? "owner" : "member",
}));

// 2) Clientes (folders) e campanhas (folder|list)
const folderOf = (r) => (parseArr(r["Folder Name/Path"])[0] ?? r["Folder Name/Path"] ?? "Sem cliente").trim();
const clients = [...new Set(rows.map(folderOf))];
const campaignKeys = [...new Set(rows.map((r) => `${folderOf(r)}|||${r["List Name"].trim()}`))];

// 3) Resumo
console.log(`\n— Resumo —`);
console.log(`  Org alvo     : ${ORG_NAME}  (slug: ${ORG_SLUG})`);
console.log(`  Usuários     : ${users.length}`);
for (const u of users) console.log(`     ${u.role === "owner" ? "★" : " "} ${u.email}  (${u.name})`);
console.log(`  Clientes     : ${clients.length} → ${clients.join(", ")}`);
console.log(`  Campanhas    : ${campaignKeys.length}`);
console.log(`  Atividades   : ${rows.length}`);
const unknownStatus = [...new Set(rows.map((r) => r["Status"].trim().toLowerCase()))].filter((s) => s && !STATUS_MAP[s]);
if (unknownStatus.length) console.log(`  ⚠ status sem mapeamento (→ ${STATUS_FALLBACK}): ${unknownStatus.join(", ")}`);

if (DRY) {
  console.log("\n--dry: nada foi gravado.");
  process.exit(0);
}

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  console.error("✗ Falta DATABASE_URL. Ex.: DATABASE_URL=postgres://... node scripts/seed-clickup.mjs");
  process.exit(1);
}

const sql = postgres(DATABASE_URL, { max: 4 });

if (process.argv.includes("--check")) {
  try {
    const [r] = await sql`select now() as agora, current_database() as db`;
    console.log(`✓ Conectado: ${r.db} @ ${r.agora}`);
  } catch (e) {
    console.error("✗ Falha na conexão:", e.message);
    process.exitCode = 1;
  } finally {
    await sql.end();
  }
  process.exit(process.exitCode ?? 0);
}

try {
  await sql.begin(async (sql) => {
    // ORG: reutiliza a existente (NÃO renomeia); cria só se não existir.
    let [org] = await sql`select id from organizations where slug = ${ORG_SLUG} limit 1`;
    if (org) {
      console.log(`= org existente reutilizada: ${ORG_SLUG} (${org.id})`);
    } else {
      [org] = await sql`
        insert into organizations (name, slug, plan, max_members)
        values (${ORG_NAME}, ${ORG_SLUG}, 'pro', 100)
        returning id
      `;
      console.log(`+ org criada: ${ORG_NAME} (${org.id})`);
    }
    const orgId = org.id;

    if (RESET) {
      // destrutivo: apaga SÓ os workspaces cujos nomes estão neste CSV (cascata
      // derruba campaigns/activities/assignees). Exige confirmação explícita.
      if (process.env.CONFIRM_RESET !== "1") {
        throw new Error("--reset é destrutivo: rode de novo com CONFIRM_RESET=1 pra confirmar.");
      }
      const del = await sql`delete from workspaces where org_id = ${orgId} and name = any(${clients})`;
      console.log(`🧹 reset: ${del.count} workspace(s) dos clientes do CSV removidos`);
    }

    // USERS (auth.users + profile via trigger) + organization_members
    const userId = new Map(); // email → id
    for (const u of users) {
      const hash = await hashSenha(SEED_PASSWORD);
      const ins = await sql`
        insert into auth.users (email, encrypted_password, raw_user_meta_data)
        values (${u.email}, ${hash}, ${sql.json({ full_name: u.name })})
        on conflict (email) do nothing
        returning id
      `;
      let id = ins[0]?.id;
      if (!id) {
        const [ex] = await sql`select id from auth.users where lower(email) = lower(${u.email}) limit 1`;
        id = ex.id;
      }
      userId.set(u.email, id);
      // não altera quem já é membro (preserva papéis reais existentes)
      await sql`
        insert into organization_members (org_id, user_id, role)
        values (${orgId}, ${id}, ${u.role})
        on conflict (org_id, user_id) do nothing
      `;
    }
    const ownerId = userId.get(users.find((u) => u.role === "owner")?.email) ?? [...userId.values()][0];

    // WORKSPACES (clientes)
    const wsId = new Map(); // nome → id
    for (const c of clients) {
      const [existing] = await sql`select id from workspaces where org_id = ${orgId} and name = ${c} limit 1`;
      if (existing) { wsId.set(c, existing.id); continue; }
      const [w] = await sql`
        insert into workspaces (org_id, name, created_by) values (${orgId}, ${c}, ${ownerId}) returning id
      `;
      wsId.set(c, w.id);
    }

    // CAMPAIGNS
    const campId = new Map(); // "folder|||list" → id
    for (const key of campaignKeys) {
      const [folder, list] = key.split("|||");
      const wid = wsId.get(folder);
      const [existing] = await sql`select id from campaigns where workspace_id = ${wid} and name = ${list} limit 1`;
      if (existing) { campId.set(key, existing.id); continue; }
      const [cp] = await sql`
        insert into campaigns (workspace_id, name, created_by) values (${wid}, ${list}, ${ownerId}) returning id
      `;
      campId.set(key, cp.id);
    }

    // ACTIVITIES + assignees
    let created = 0, skipped = 0;
    for (const [i, r] of rows.entries()) {
      const folder = folderOf(r);
      const key = `${folder}|||${r["List Name"].trim()}`;
      const cid = campId.get(key);
      const title = cleanTitle(r["Task Name"]);
      const status = STATUS_MAP[r["Status"].trim().toLowerCase()] ?? STATUS_FALLBACK;
      const priority = PRIORITY_MAP[(r["Priority"] ?? "").trim()] ?? "medium";
      const startDate = parseDate(r["Start Date Text"]);
      const dueDate = parseDate(r["Due Date Text"]);
      const createdAt = parseDate(r["Date Created Text"]);
      const description = cleanContent(r["Task Content"]);

      // idempotência: pula se já existe atividade com mesmo título na campanha
      const [dup] = await sql`select id from activities where campaign_id = ${cid} and title = ${title} limit 1`;
      if (dup) { skipped++; continue; }

      const [act] = await sql`
        insert into activities
          (campaign_id, title, description, status, priority, start_date, due_date, sort_order, created_by, created_at)
        values
          (${cid}, ${title}, ${description}, ${status}, ${priority},
           ${startDate}, ${dueDate}, ${i}, ${ownerId}, ${createdAt ?? sql`now()`})
        returning id
      `;
      created++;

      for (const name of parseArr(r["Assignees"])) {
        const uid = userId.get(emailFor(name));
        if (!uid) continue;
        await sql`
          insert into activity_assignees (activity_id, user_id) values (${act.id}, ${uid})
          on conflict (activity_id, user_id) do nothing
        `;
      }
    }
    console.log(`\n✓ Atividades criadas: ${created} | puladas (já existiam): ${skipped}`);
    console.log(`✓ Org: ${ORG_NAME} (${orgId})`);
  });

  console.log(`\n🎉 Seed concluído. Login de teste: qualquer e-mail acima / senha "${SEED_PASSWORD}".`);
} catch (e) {
  console.error("\n✗ Erro no seed:", e.message);
  process.exitCode = 1;
} finally {
  await sql.end();
}
