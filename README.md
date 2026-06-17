# Agency Workflow ("Flow")

Gestão de pauta e atividades para agências. App [Next.js 16](AGENTS.md) (App
Router) **self-hosted num VPS** — sem Vercel, sem Supabase Cloud.

## Stack

| Camada      | O que usamos                                                                 |
|-------------|------------------------------------------------------------------------------|
| Hosting     | VPS (Coolify)                                                                |
| Banco       | Postgres 17 + [PostgREST](https://postgrest.org) self-hosted                  |
| Dados       | `@supabase/supabase-js` usado **só como cliente HTTP do PostgREST** (`.from()`/`.rpc()`), carregando nosso JWT |
| Auth        | JWT HS256 próprio (cookie `flow-jwt`), sem GoTrue — ver [`src/lib/auth`](src/lib/auth) |
| Autorização | RLS no Postgres (o PostgREST valida o JWT e faz `SET ROLE`)                   |
| Storage     | Volume no VPS (avatars, org-logos) — sem Supabase Storage — ver [`src/app/api/upload`](src/app/api/upload/route.ts) |
| Email       | [Resend](https://resend.com)                                                 |

> O nome "supabase" persiste em alguns lugares (`src/lib/supabase/`,
> `NEXT_PUBLIC_SUPABASE_*`) porque a lib `supabase-js` segue sendo o cliente do
> PostgREST. Não há mais nenhuma dependência do serviço gerenciado Supabase.

## Desenvolvimento

```bash
npm install
npm run dev   # http://localhost:3000
```

Copie/preencha o [`.env.local`](.env.local) — as variáveis estão documentadas
inline lá. As essenciais: `NEXT_PUBLIC_SUPABASE_URL` (domínio do PostgREST),
`NEXT_PUBLIC_SUPABASE_ANON_KEY` (JWT `{role:anon}`), `JWT_SECRET` (o mesmo do
PostgREST) e `DATABASE_URL`.

## Deploy / infra

Setup do VPS (PostgREST, auth, ordem de migrations, env do Coolify):
[`supabase/vps/README.md`](supabase/vps/README.md).

## Notas

- Este é um **Next.js 16 com breaking changes** — leia o guia relevante em
  `node_modules/next/dist/docs/` antes de editar código (ver [AGENTS.md](AGENTS.md)).
