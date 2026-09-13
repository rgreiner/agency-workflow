<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

# Flow (agency-workflow)

Gestão de pauta/atividades da One a One (pode virar SaaS). Produção: **https://flow.oneaone.com.br** (VPS Coolify; push na `main` = deploy automático).

## Stack
- Next 16 (App Router, middleware = `proxy.ts`) + React 19 + Tailwind 4, TypeScript.
- **Postgres 17 + PostgREST self-hosted** (`https://flow-api.oneaone.com.br`). O `@supabase/supabase-js` é usado **de propósito como cliente HTTP do PostgREST** — NÃO sugerir remover nem "migrar pra Supabase". Não existe Supabase Cloud/GoTrue.
- Auth própria: cookie JWT **`flow-jwt`** (HS256, `JWT_SECRET`, `src/lib/auth/*`); RLS no banco lê `request.jwt.claims`.
- Conexão direta (`lib postgres`) só para `auth.users` — e sempre **lazy** (nunca conectar no import).
- E-mail: Resend. IA: **Gemini e só** — tudo passa por `src/lib/ai/gemini.ts` (AI Studio por chave ou Vertex por service account). `npm run test:revisao` testa a chave.

## Comandos
- `npm run dev` · `npm run build` · `npm run lint` · `npm run typecheck`
- Antes de commitar: typecheck + lint. Commit pequeno, mensagem pt-BR com prefixo temático.

## Banco / migrations
- `supabase/migrations/NNN_nome.sql`, **idempotentes** (`if not exists` / `create or replace`).
- **Aplicar em produção ANTES do push do código.** Claude pode aplicar o comando (one-liner ssh, caminho absoluto); Container do Postgres: achar **pelo schema** (tem a tabela `activities`), nunca pelo nome. Finalizar com `notify pgrst, 'reload schema'`.
- PostgREST self-hosted é estrito com overloads: **1 assinatura por RPC**.
- Setup do PostgREST no VPS documentado em `supabase/vps/README.md`.

## UI
- Sempre `components/ui/Select` (nunca `<select>` nativo). Accent laranja `#f97316` (configurável pela org — nunca roxo/indigo). Direção visual "soft/premium": inputs preenchidos (`bg-gray-100 border-transparent rounded-xl`), cantos xl/2xl, sombras difusas; dark = neutro quente. Toast: sonner.
- Backlog vivo de melhorias na memória do projeto — ao concluir uma entrega, sugerir a próxima.

## Regras de operação — valem para QUALQUER sessão, inclusive na nuvem

Estas regras existem porque cada uma já custou uma entrega. Leia antes de escrever SQL
ou de tentar alcançar o servidor.

- **Quem aplica migration em produção é a sessão LOCAL do Mac do Rafael**, que tem SSH
  para o VPS pela ferramenta Bash. Sessão de nuvem (branch `claude/*`) **não alcança**
  `72.61.27.227`: não é configuração, é o ambiente. Não proponha terminal do Coolify
  (isso é o Rafael copiando e colando à mão) nem endpoint HTTP que roda DDL (dívida de
  segurança). Seu trabalho termina no push da SUA branch; diga por escrito o que precisa
  ser aplicado e o que conferir. Nunca faça push na `main`.
- **Migration ANTES do código que a usa.** Arquivo `.sql` cru por stdin via SSH; achar o
  container do Postgres **pelo schema** (o que tem a tabela `activities`), nunca pelo
  nome — o hash muda a cada redeploy. Terminar com `notify pgrst, 'reload schema'`.
- ⚠️ **`revoke ... from public` NÃO fecha nada neste banco.** Há
  `ALTER DEFAULT PRIVILEGES ... GRANT EXECUTE ON FUNCTIONS TO anon, authenticated`:
  **toda função nova nasce chamável por `anon` e `authenticated`**, e revogar de PUBLIC
  não toca nesses dois grants. Helper interno fecha assim:
  `revoke execute on function f(args) from public, anon, authenticated;`
  E **confira no banco depois de aplicar**, nunca confie no que a migration diz que fez:
  `select has_function_privilege('anon','f(args)','execute');`
  (13/09/2026: uma função SECURITY DEFINER que devolvia os títulos de todas as orgs ficou
  chamável sem login por causa disso; a 167 e a 183 já descreviam a armadilha.)
- **PostgREST é estrito: 1 assinatura por RPC.** Parâmetro novo exige DROP + CREATE, nunca
  overload. View sempre com `security_invoker = true`.
- **Medir em produção antes de teorizar.** Diagnóstico read-only por SSH responde em um
  minuto o que a teoria erra em três tentativas. Contar linha de migration no repo não
  mede privilégio: o que vale é o que está vivo no banco.
- **Commitar por caminho:** `git commit -m "…" -- <arquivos>`. Outra sessão pode ter
  deixado arquivo no índice, e um `git commit` sem caminho leva tudo junto (já aconteceu).
- **Antes de commitar:** `npm run typecheck` + `npm run lint`. Quem barra o deploy é o
  build do Coolify; `npm run build` local falha por falta de `DATABASE_URL` no `.env.local`
  e isso é esperado, não é regressão.
