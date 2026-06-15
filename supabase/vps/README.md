# VPS deploy (PostgREST + own auth) — agency-workflow

Self-hosted setup that keeps the existing Supabase-client data calls (`.from()`,
`.rpc()`) and RLS working against a **plain Postgres 17 + PostgREST**, with our
own email/password auth (no GoTrue) and our own storage (no Supabase Storage).

## Architecture

```
Browser → Next.js app  ──(.from/.rpc via supabase-js, carrying OUR jwt)──→ PostgREST → Postgres 17
                       ── own email/password auth → mints JWT { sub, role:'authenticated' }
                       ── own storage (volume/R2) for avatars + org-logos
```

PostgREST verifies the JWT with a shared secret, sets `request.jwt.claims`, and
`SET ROLE` to the `role` claim. `auth.uid()` (defined in `00_bootstrap.sql`)
reads `sub` from those claims, so **all RLS + RPCs run unchanged**.

## DB apply order

Run against the `agency-db` Postgres container, in this exact order:

1. `00_bootstrap.sql`            — extensions, roles, `auth` schema/users, `auth.uid()`
2. `001` … `016`                 — original migrations, verbatim
3. **skip `017_org_logos_bucket.sql`** — Supabase Storage only
4. `018b_update_profile.sql`     — replaces `018` (storage stripped, RPC kept)
5. `019_visual_boards.sql`       — verbatim
6. `99_grants.sql`               — table/function grants to anon/authenticated

### Apply command (from the VPS)

```bash
# copy this repo's supabase/ dir to the VPS, then, with PG = agency-db container:
PG=<agency-db-container-uuid>
cd /path/to/agency-workflow/supabase

cat vps/00_bootstrap.sql                         | docker exec -i $PG psql -U postgres -v ON_ERROR_STOP=1
for f in migrations/00{1,2,3,4,5,6,7,8,9}_*.sql migrations/01{0,1,2,3,4,5,6}_*.sql; do
  echo ">> $f"; docker exec -i $PG psql -U postgres -v ON_ERROR_STOP=1 < "$f"
done
# 017 skipped on purpose
docker exec -i $PG psql -U postgres -v ON_ERROR_STOP=1 < vps/018b_update_profile.sql
docker exec -i $PG psql -U postgres -v ON_ERROR_STOP=1 < migrations/019_visual_boards.sql
docker exec -i $PG psql -U postgres -v ON_ERROR_STOP=1 < vps/99_grants.sql
```

### Set the authenticator password (one-time, matches PGRST_DB_URI)

```sql
ALTER ROLE authenticator WITH PASSWORD '<authenticator-pw>';
```

## PostgREST container env (Coolify resource)

| Var | Value |
|-----|-------|
| `PGRST_DB_URI` | `postgres://authenticator:<authenticator-pw>@<agency-db>:5432/postgres` |
| `PGRST_DB_SCHEMA` | `public` |
| `PGRST_DB_ANON_ROLE` | `anon` |
| `PGRST_JWT_SECRET` | shared HS256 secret (same one the app signs JWTs with) |
| `PGRST_JWT_ROLE_CLAIM_KEY` | `.role` (default) |

Expose port `3000` (PostgREST default), give it a public domain **with `https://`**
(e.g. `https://api-agency.oneaone.com.br`) so the browser client can reach it.

## App env (Coolify — Next.js resource)

| Var | Value |
|-----|-------|
| `NEXT_PUBLIC_SUPABASE_URL` | `https://api-agency.oneaone.com.br` (PostgREST domain; supabase-js posts to `/rest/v1` → PostgREST serves `/`) |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | an HS256 JWT `{ "role": "anon" }` signed with `PGRST_JWT_SECRET` |
| `JWT_SECRET` | same secret used by PostgREST, to sign session JWTs |
| `SESSION_SECRET` | cookie signing (own auth) |

> Note: supabase-js targets `/<base>/rest/v1` and `/<base>/auth/v1`. PostgREST
> serves tables at its root. Confirm the base-path mapping during Fase 1 (a
> Traefik path-rewrite or a thin route may be needed); this is the main thing to
> validate at the Fase 1 milestone.

## What changes in the app (Fase 2/3)

- `src/lib/supabase/{client,server,middleware}.ts` → point at PostgREST URL,
  attach our session JWT via the `accessToken` option (no GoTrue session).
- `login/page.tsx`, `auth/callback/route.ts`, `convite/.../ConviteLoginButton.tsx`
  → email/password (reuse the CRM `src/lib/auth/*` pattern).
- 2 storage call sites (`avatars`, `org-logos`) → own storage.
- The ~90 `.from()` + 26 `.rpc()` calls are **untouched**.

> ⚠️ This app is Next.js 16 with breaking changes (see AGENTS.md): read
> `node_modules/next/dist/docs/` before editing app code.
