#!/usr/bin/env node
/**
 * Verifica quais migrations do repositório NÃO foram aplicadas em produção.
 *
 * Não existe tabela de controle (as migrations são aplicadas à mão, via one-liner),
 * então a checagem é por EVIDÊNCIA: extrai de cada arquivo os objetos que ele cria
 * (tabela, coluna, função, view) e confere se existem no banco. Se algum objeto de
 * uma migration está faltando, ela não rodou — ou rodou pela metade.
 *
 * É heurístico de propósito: prefere falso-positivo (avisar à toa) a falso-negativo,
 * porque o custo do silêncio já ficou claro — a 043 passou 8 dias quebrando a tela
 * de Lançamentos sem ninguém saber.
 *
 * Uso:  node scripts/check-migrations.mjs            # imprime o SQL de checagem
 *       node scripts/check-migrations.mjs --sql-only # só o SQL (para o one-liner)
 */
import { readFileSync, readdirSync } from 'node:fs'
import path from 'node:path'

const DIR = path.join(process.cwd(), 'supabase/migrations')

// Só objetos do schema public (sem prefixo de schema). `auth.users` e afins são
// geridos à parte e o nome do schema seria capturado como se fosse a tabela.
const RE = {
  table: /create\s+table\s+(?:if\s+not\s+exists\s+)?([a-z_][a-z0-9_]*)(?!\s*\.)\s*\(/gi,
  view: /create\s+(?:or\s+replace\s+)?view\s+([a-z_][a-z0-9_]*)(?!\s*\.)/gi,
  func: /create\s+(?:or\s+replace\s+)?function\s+([a-z_][a-z0-9_]*)\s*\(/gi,
  column: /alter\s+table\s+([a-z_][a-z0-9_]*)\s+add\s+column\s+(?:if\s+not\s+exists\s+)?([a-z_][a-z0-9_]*)/gi,
}

/**
 * Objetos criados por uma migration e REMOVIDOS de propósito por outra depois.
 * Sem essa lista o verificador acusaria pra sempre a migration original.
 * Formato: 'nome_do_objeto': 'por que sumiu'.
 */
const REMOVIDOS_DE_PROPOSITO = {
  atualizar_saldos_conta_azul: 'dropada na 127 — gravava saldo_inicial = realizado do extrato (dupla contagem)',
}

/** Remove comentários pra não capturar objeto citado em texto explicativo. */
function semComentarios(sql) {
  return sql.replace(/--[^\n]*/g, '').replace(/\/\*[\s\S]*?\*\//g, '')
}

const alvos = []
for (const arq of readdirSync(DIR).filter(f => f.endsWith('.sql')).sort()) {
  const sql = semComentarios(readFileSync(path.join(DIR, arq), 'utf8'))
  const add = (tipo, nome, extra) => alvos.push({ arq, tipo, nome, extra })

  for (const m of sql.matchAll(RE.table)) add('table', m[1])
  for (const m of sql.matchAll(RE.view)) add('view', m[1])
  for (const m of sql.matchAll(RE.func)) add('func', m[1])
  for (const m of sql.matchAll(RE.column)) add('column', m[1], m[2])
}

const ignorados = alvos.filter(a => REMOVIDOS_DE_PROPOSITO[a.nome])
const pendentes = alvos.filter(a => !REMOVIDOS_DE_PROPOSITO[a.nome])
alvos.length = 0
alvos.push(...pendentes)

// Uma linha de VALUES por objeto; o SQL decide se existe.
const values = alvos.map(a =>
  `('${a.arq}','${a.tipo}','${a.nome}',${a.extra ? `'${a.extra}'` : 'null'})`).join(',\n    ')

const sql = `
with alvo(arq, tipo, nome, extra) as (values
    ${values}
),
faltando as (
  select * from alvo a where not case a.tipo
    when 'table'  then exists (select 1 from pg_class c where c.relname = a.nome and c.relkind in ('r','p'))
    when 'view'   then exists (select 1 from pg_class c where c.relname = a.nome and c.relkind in ('v','m'))
    when 'func'   then exists (select 1 from pg_proc p where p.proname = a.nome)
    when 'column' then exists (select 1 from information_schema.columns c
                               where c.table_name = a.nome and c.column_name = a.extra)
    else true end
)
select arq as migration, tipo, nome || coalesce('.' || extra, '') as objeto_faltando
from faltando order by arq, tipo, nome;
`

if (process.argv.includes('--sql-only')) {
  process.stdout.write(sql)
} else {
  console.error(`# ${alvos.length} objetos de ${new Set(alvos.map(a => a.arq)).size} migrations`)
  if (ignorados.length) console.error(`# ${ignorados.length} ignorado(s) por remoção intencional`)
  process.stdout.write(sql)
}
