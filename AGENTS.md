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
- E-mail: Resend. IA (revisão de redação): `@anthropic-ai/sdk` (`npm run test:revisao`).

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
