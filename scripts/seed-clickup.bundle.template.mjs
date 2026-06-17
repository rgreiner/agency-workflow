/**
 * Seed self-contained (dados do ClickUp EMBUTIDOS) — pensado pra rodar DENTRO
 * do container do app Flow, onde já existem node, o pacote `postgres` e a env
 * DATABASE_URL (apontando pro banco certo). Sem CSV, sem senha no comando.
 *
 * GERADO por scripts/build-seed-bundle.mjs a partir do CSV — não editar à mão.
 *
 * Opções por variável de ambiente:
 *   SEED_DRY=1       só mostra o resumo, não grava (não conecta)
 *   SEED_CHECK=1     só testa a conexão e sai
 *   SEED_RESET=1     apaga os workspaces destes clientes antes (exige CONFIRM_RESET=1)
 *   ORG_SLUG         (default "one-a-one")  ORG_NAME (default "One a One")
 *   EMAIL_DOMAIN     (default "oneaone.com.br")
 *   SEED_PASSWORD    (default "teste1234")
 *   OWNER_NAME       (default "Rafael Greiner")
 */
import postgres from "postgres";
import { scrypt, randomBytes } from "node:crypto";
import { promisify } from "node:util";

const scryptAsync = promisify(scrypt);

// Registros embutidos (mesmas chaves das colunas do CSV que usamos).
const RECORDS = /*__RECORDS__*/ [];

const DRY = process.env.SEED_DRY === "1";
const CHECK = process.env.SEED_CHECK === "1";
const RESET = process.env.SEED_RESET === "1";
const ORG_NAME = process.env.ORG_NAME ?? "One a One";
const ORG_SLUG = process.env.ORG_SLUG ?? "one-a-one";
const EMAIL_DOMAIN = process.env.EMAIL_DOMAIN ?? "oneaone.com.br";
const SEED_PASSWORD = process.env.SEED_PASSWORD ?? "teste1234";
const OWNER_NAME = process.env.OWNER_NAME ?? "Rafael Greiner";

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
const PRIORITY_MAP = { "1": "urgent", "2": "high", "3": "medium", "4": "low" };

async function hashSenha(senha) {
  const salt = randomBytes(16).toString("hex");
  const derivado = await scryptAsync(senha, salt, 64);
  return `${salt}:${derivado.toString("hex")}`;
}
function parseArr(s) {
  s = (s ?? "").trim();
  if (!s || s === "[]" || s === "null") return [];
  return s.replace(/^\[|\]$/g, "").split(",").map((p) => p.trim().replace(/^"|"$/g, "").trim()).filter(Boolean);
}
function stripAccents(s) { return s.normalize("NFD").replace(/[̀-ͯ]/g, ""); }
function parseDate(s) {
  s = (s ?? "").trim();
  if (!s || s === "null") return null;
  const m = s.match(/(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (!m) return null;
  const [, mo, d, y] = m;
  return `${y}-${mo.padStart(2, "0")}-${d.padStart(2, "0")}`;
}
function cleanTitle(name) {
  const t = (name ?? "").trim();
  const m = t.match(/^\d{6}\s*-\s*(.+)$/);
  return (m ? m[1] : t).trim() || t;
}
function cleanContent(s) {
  s = (s ?? "").trim();
  if (!s || s === "null") return null;
  return s.replace(/\\n/g, "\n").replace(/\\t/g, "\t");
}

const rows = RECORDS;
console.log(`📦 Seed embutido — ${rows.length} tarefas`);

// Usuários distintos + e-mail (sobrenome só em colisão de 1º nome)
const nameCounts = new Map();
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
  if (collides && parts[1]) local = `${first}.${stripAccents(parts[1]).toLowerCase().replace(/[^a-z0-9]/g, "")}`;
  return `${local}@${EMAIL_DOMAIN}`;
}
const users = [...allNames].map((name) => ({
  name, email: emailFor(name),
  role: name.trim().toLowerCase() === OWNER_NAME.toLowerCase() ? "owner" : "member",
}));

const folderOf = (r) => (parseArr(r["Folder Name/Path"])[0] ?? r["Folder Name/Path"] ?? "Sem cliente").trim();
const clients = [...new Set(rows.map(folderOf))];
const campaignKeys = [...new Set(rows.map((r) => `${folderOf(r)}|||${r["List Name"].trim()}`))];

console.log(`\n— Resumo —`);
console.log(`  Org alvo   : ${ORG_NAME}  (slug: ${ORG_SLUG})`);
console.log(`  Usuários   : ${users.length}`);
for (const u of users) console.log(`     ${u.role === "owner" ? "★" : " "} ${u.email}  (${u.name})`);
console.log(`  Clientes   : ${clients.length} → ${clients.join(", ")}`);
console.log(`  Campanhas  : ${campaignKeys.length}`);
console.log(`  Atividades : ${rows.length}`);
const unknownStatus = [...new Set(rows.map((r) => r["Status"].trim().toLowerCase()))].filter((s) => s && !STATUS_MAP[s]);
if (unknownStatus.length) console.log(`  ⚠ status sem mapeamento (→ ${STATUS_FALLBACK}): ${unknownStatus.join(", ")}`);

if (DRY) { console.log("\nSEED_DRY: nada foi gravado."); process.exit(0); }

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) { console.error("✗ Falta DATABASE_URL (rode dentro do container do app)."); process.exit(1); }
const sql = postgres(DATABASE_URL, { max: 4 });

if (CHECK) {
  try {
    const [r] = await sql`select now() as agora, current_database() as db`;
    console.log(`✓ Conectado: ${r.db} @ ${r.agora}`);
  } catch (e) { console.error("✗ Falha na conexão:", e.message); process.exitCode = 1; }
  finally { await sql.end(); }
  process.exit(process.exitCode ?? 0);
}

try {
  await sql.begin(async (sql) => {
    let [org] = await sql`select id from organizations where slug = ${ORG_SLUG} limit 1`;
    if (org) console.log(`= org existente reutilizada: ${ORG_SLUG} (${org.id})`);
    else {
      [org] = await sql`insert into organizations (name, slug, plan, max_members) values (${ORG_NAME}, ${ORG_SLUG}, 'pro', 100) returning id`;
      console.log(`+ org criada: ${ORG_NAME} (${org.id})`);
    }
    const orgId = org.id;

    if (RESET) {
      if (process.env.CONFIRM_RESET !== "1") throw new Error("SEED_RESET é destrutivo: rode também com CONFIRM_RESET=1.");
      const del = await sql`delete from workspaces where org_id = ${orgId} and name = any(${clients})`;
      console.log(`🧹 reset: ${del.count} workspace(s) dos clientes removidos`);
    }

    const userId = new Map();
    for (const u of users) {
      const hash = await hashSenha(SEED_PASSWORD);
      const ins = await sql`
        insert into auth.users (email, encrypted_password, raw_user_meta_data)
        values (${u.email}, ${hash}, ${sql.json({ full_name: u.name })})
        on conflict (email) do nothing returning id`;
      let id = ins[0]?.id;
      if (!id) { const [ex] = await sql`select id from auth.users where lower(email) = lower(${u.email}) limit 1`; id = ex.id; }
      userId.set(u.email, id);
      await sql`insert into organization_members (org_id, user_id, role) values (${orgId}, ${id}, ${u.role}) on conflict (org_id, user_id) do nothing`;
    }
    const ownerId = userId.get(users.find((u) => u.role === "owner")?.email) ?? [...userId.values()][0];

    const wsId = new Map();
    for (const c of clients) {
      const [existing] = await sql`select id from workspaces where org_id = ${orgId} and name = ${c} limit 1`;
      if (existing) { wsId.set(c, existing.id); continue; }
      const [w] = await sql`insert into workspaces (org_id, name, created_by) values (${orgId}, ${c}, ${ownerId}) returning id`;
      wsId.set(c, w.id);
    }

    const campId = new Map();
    for (const key of campaignKeys) {
      const [folder, list] = key.split("|||");
      const wid = wsId.get(folder);
      const [existing] = await sql`select id from campaigns where workspace_id = ${wid} and name = ${list} limit 1`;
      if (existing) { campId.set(key, existing.id); continue; }
      const [cp] = await sql`insert into campaigns (workspace_id, name, created_by) values (${wid}, ${list}, ${ownerId}) returning id`;
      campId.set(key, cp.id);
    }

    let created = 0, skipped = 0;
    for (const [i, r] of rows.entries()) {
      const key = `${folderOf(r)}|||${r["List Name"].trim()}`;
      const cid = campId.get(key);
      const title = cleanTitle(r["Task Name"]);
      const status = STATUS_MAP[r["Status"].trim().toLowerCase()] ?? STATUS_FALLBACK;
      const priority = PRIORITY_MAP[(r["Priority"] ?? "").trim()] ?? "medium";
      const startDate = parseDate(r["Start Date Text"]);
      const dueDate = parseDate(r["Due Date Text"]);
      const createdAt = parseDate(r["Date Created Text"]);
      const description = cleanContent(r["Task Content"]);

      const [dup] = await sql`select id from activities where campaign_id = ${cid} and title = ${title} limit 1`;
      if (dup) { skipped++; continue; }

      const [act] = await sql`
        insert into activities (campaign_id, title, description, status, priority, start_date, due_date, sort_order, created_by, created_at)
        values (${cid}, ${title}, ${description}, ${status}, ${priority}, ${startDate}, ${dueDate}, ${i}, ${ownerId}, ${createdAt ?? sql`now()`})
        returning id`;
      created++;

      for (const name of parseArr(r["Assignees"])) {
        const uid = userId.get(emailFor(name));
        if (!uid) continue;
        await sql`insert into activity_assignees (activity_id, user_id) values (${act.id}, ${uid}) on conflict (activity_id, user_id) do nothing`;
      }
    }
    console.log(`\n✓ Atividades criadas: ${created} | puladas (já existiam): ${skipped}`);
    console.log(`✓ Org: ${ORG_NAME} (${orgId})`);
  });
  console.log(`\n🎉 Seed concluído. Login: e-mails acima / senha "${SEED_PASSWORD}".`);
} catch (e) {
  console.error("\n✗ Erro no seed:", e.message);
  process.exitCode = 1;
} finally {
  await sql.end();
}
