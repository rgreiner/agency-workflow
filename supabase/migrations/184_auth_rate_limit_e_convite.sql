-- 184_auth_rate_limit_e_convite.sql
-- Auditoria 02/08 — "Segurança e acesso", achado 6: nenhum ponto de
-- autenticação tinha limite de tentativa, lockout ou registro — login do
-- membro, login do portal, pedido de magic link e reset de senha aceitavam
-- tentativa infinita, sem deixar rastro. E o convite por link não expirava.
--
-- A tabela fica no schema `auth` de propósito: quem escreve nela é a camada de
-- auth (lib/db, conexão direta), que roda ANTES de existir sessão — e o schema
-- auth não é exposto pelo PostgREST, então ninguém lê isso de fora.
--
-- Idempotente.

create table if not exists auth.login_attempts (
  id          bigserial primary key,
  kind        text        not null,             -- login | portal | portal_magic | reset
  identifier  text        not null,             -- e-mail em minúsculas ('-' quando não há)
  ip          text        not null default '-',
  ok          boolean     not null default false,
  created_at  timestamptz not null default now()
);

create index if not exists idx_login_attempts_id
  on auth.login_attempts (kind, identifier, created_at desc);
create index if not exists idx_login_attempts_ip
  on auth.login_attempts (kind, ip, created_at desc);
create index if not exists idx_login_attempts_purge
  on auth.login_attempts (created_at);

-- ── Convite por link com validade ───────────────────────────────────────────
-- upsert_invite_link já rotaciona o token a cada vez que o admin abre o modal,
-- então a validade curta não atrapalha o uso: cada cópia nova nasce com 7 dias.
-- O que ela impede é o link vazado meses atrás continuar valendo pra sempre.
-- Links já inativos ganham a coluna e seguem inativos — não precisam backfill.
alter table org_invite_links
  add column if not exists expires_at timestamptz not null default (now() + interval '7 days');

create or replace function upsert_invite_link(p_user_id uuid, p_org_id uuid, p_role member_role)
returns uuid language plpgsql security definer set search_path to 'public' as $$
DECLARE v_caller_role member_role; v_token uuid;
BEGIN
  if p_user_id is distinct from auth.uid() then
    raise exception 'Acesso negado' using errcode = '42501';
  end if;
  SELECT role INTO v_caller_role FROM organization_members
   WHERE org_id = p_org_id AND user_id = p_user_id AND arquivado = false;
  IF v_caller_role IS NULL OR v_caller_role NOT IN ('owner','admin') THEN RAISE EXCEPTION 'Permissão negada'; END IF;
  UPDATE org_invite_links SET is_active = false WHERE org_id = p_org_id AND role = p_role AND is_active = true;
  INSERT INTO org_invite_links (org_id, role, created_by, expires_at)
  VALUES (p_org_id, p_role, p_user_id, now() + interval '7 days') RETURNING token INTO v_token;
  RETURN v_token;
END;
$$;

create or replace function deactivate_invite_link(p_user_id uuid, p_org_id uuid)
returns void language plpgsql security definer set search_path to 'public' as $$
DECLARE v_caller_role member_role;
BEGIN
  if p_user_id is distinct from auth.uid() then
    raise exception 'Acesso negado' using errcode = '42501';
  end if;
  SELECT role INTO v_caller_role FROM organization_members
   WHERE org_id = p_org_id AND user_id = p_user_id AND arquivado = false;
  IF v_caller_role IS NULL OR v_caller_role NOT IN ('owner','admin') THEN RAISE EXCEPTION 'Permissão negada'; END IF;
  UPDATE org_invite_links SET is_active = false WHERE org_id = p_org_id AND is_active = true;
END;
$$;

-- A tela de convite lê `is_active`; devolver `false` pra link vencido reusa a
-- mensagem "link inválido ou expirado" que já existe, sem mexer no front.
create or replace function get_invite_info(p_token uuid)
returns table(token uuid, is_active boolean, role member_role, org_name text, org_slug text)
language plpgsql security definer set search_path to 'public' as $$
BEGIN
  RETURN QUERY
  SELECT il.token,
         (il.is_active and il.expires_at > now()) as is_active,
         il.role,
         o.name AS org_name,
         o.slug AS org_slug
  FROM org_invite_links il
  JOIN organizations o ON o.id = il.org_id
  WHERE il.token = p_token;
END;
$$;

create or replace function accept_invite_link(p_user_id uuid, p_token uuid)
returns text language plpgsql security definer set search_path to 'public' as $$
DECLARE v_link org_invite_links%ROWTYPE; v_slug text; v_exists boolean;
BEGIN
  if p_user_id is distinct from auth.uid() then
    raise exception 'Acesso negado' using errcode = '42501';
  end if;
  SELECT * INTO v_link FROM org_invite_links WHERE token = p_token;
  IF NOT FOUND THEN RAISE EXCEPTION 'Link não encontrado'; END IF;
  IF NOT v_link.is_active THEN RAISE EXCEPTION 'Link inativo'; END IF;
  IF v_link.expires_at <= now() THEN RAISE EXCEPTION 'Link expirado — peça um novo ao administrador'; END IF;
  SELECT slug INTO v_slug FROM organizations WHERE id = v_link.org_id;
  SELECT EXISTS (SELECT 1 FROM organization_members WHERE org_id = v_link.org_id AND user_id = p_user_id) INTO v_exists;
  IF v_exists THEN RETURN v_slug; END IF;
  INSERT INTO organization_members (org_id, user_id, role, invited_by) VALUES (v_link.org_id, p_user_id, v_link.role, v_link.created_by);
  UPDATE org_invite_links SET use_count = use_count + 1 WHERE id = v_link.id;
  RETURN v_slug;
END;
$$;

notify pgrst, 'reload schema';
