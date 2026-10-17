/**
 * Conexão Postgres direta — usada APENAS para o auth próprio (tabela
 * `auth.users`), que não é exposta pelo PostgREST (schema `public`). Todo o
 * resto dos dados continua indo pelo supabase-js → PostgREST.
 *
 * LAZY de verdade: a DATABASE_URL só é exigida no PRIMEIRO uso. Antes o arquivo
 * jogava erro já no import, e o `next build` (que carrega as rotas para coletar
 * configuração) quebrava sem a variável — o que obrigava o build a receber o
 * segredo e gravá-lo na imagem (17/10/2026, troca do Nixpacks pelo Dockerfile).
 */
import postgres from "postgres";

function criarConexao(): postgres.Sql {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error("Falta a variável de ambiente DATABASE_URL");
  }
  // SSL: Postgres interno (hostname de rótulo único, sem ponto) e local não
  // usam SSL; bancos com host de domínio público exigem.
  const isLocal = /@localhost|@127\.0\.0\.1/.test(connectionString);
  const dbHost = connectionString.match(/.*@([^:/?]+)/)?.[1]?.toLowerCase() ?? "";
  const dbNeedsSsl = !isLocal && dbHost.includes(".");
  return postgres(connectionString, {
    ssl: dbNeedsSsl ? "require" : false,
    max: 5,
  });
}

// Reusa a conexão entre hot-reloads do Next em dev.
const globalForDb = globalThis as unknown as { sql?: postgres.Sql };

function conexao(): postgres.Sql {
  if (!globalForDb.sql) globalForDb.sql = criarConexao();
  return globalForDb.sql;
}

/**
 * Mesmo uso de sempre (`sql\`...\``, `sql.json(...)`, `sql.begin(...)`): o Proxy
 * só cria a conexão quando é chamado pela primeira vez.
 */
export const sql = new Proxy(function () {} as unknown as postgres.Sql, {
  apply(_alvo, thisArg, args) {
    return Reflect.apply(conexao() as unknown as (...a: unknown[]) => unknown, thisArg, args);
  },
  get(_alvo, prop) {
    const s = conexao() as unknown as Record<PropertyKey, unknown>;
    const v = s[prop];
    return typeof v === "function" ? (v as (...a: unknown[]) => unknown).bind(s) : v;
  },
});
