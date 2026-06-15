/**
 * Conexão Postgres direta — usada APENAS para o auth próprio (tabela
 * `auth.users`), que não é exposta pelo PostgREST (schema `public`). Todo o
 * resto dos dados continua indo pelo supabase-js → PostgREST.
 */
import postgres from "postgres";

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  throw new Error("Falta a variável de ambiente DATABASE_URL");
}

// SSL: Postgres interno (hostname de rótulo único, sem ponto) e local não
// usam SSL; bancos com host de domínio público exigem.
const isLocal = /@localhost|@127\.0\.0\.1/.test(connectionString);
const dbHost = connectionString.match(/.*@([^:/?]+)/)?.[1]?.toLowerCase() ?? "";
const dbNeedsSsl = !isLocal && dbHost.includes(".");

// Reusa a conexão entre hot-reloads do Next em dev.
const globalForDb = globalThis as unknown as { sql?: postgres.Sql };

export const sql =
  globalForDb.sql ??
  postgres(connectionString, {
    ssl: dbNeedsSsl ? "require" : false,
    max: 5,
  });

if (process.env.NODE_ENV !== "production") globalForDb.sql = sql;
