-- 287_pauta_ignorar_sugestao.sql
-- "Ignorar" na lista de sugestões da Pauta (Configurações → Pauta).
--
-- O texto da tela já prometia ("promova — ou ignore, se for nome de cliente ou
-- assunto da demanda") e o botão não existia. Sem ele, o valor que a equipe digita
-- errado fica para sempre pedindo uma decisão que já foi tomada: o Rafael vai
-- ORIENTAR a pessoa, não cadastrar o valor. A sugestão some da lista e o passivo
-- de orientação não vira ruído permanente na tela.
--
-- Ignorar é REVERSÍVEL e por organização. Não apaga nada: o título já gravado
-- continua intacto e a contagem segue existindo — só sai da fila de decisão.
--
-- `org_pauta_uso` ganha a coluna `ignorado`, então é DROP + CREATE (mudar o
-- RETURNS TABLE não passa em `create or replace`) — e o PostgREST exige 1
-- assinatura por RPC de qualquer forma.
-- Idempotente.

create table if not exists org_pauta_ignorado (
  org_id     uuid not null references organizations(id) on delete cascade,
  -- lower(): "fedea" e "FEDEA" são a mesma decisão.
  chave      text not null,
  -- o texto como foi visto, só para exibir na lista de ignoradas
  valor      text not null,
  created_at timestamptz not null default now(),
  created_by uuid references profiles(id),
  primary key (org_id, chave)
);

alter table org_pauta_ignorado enable row level security;
drop policy if exists org_pauta_ignorado_read on org_pauta_ignorado;
create policy org_pauta_ignorado_read on org_pauta_ignorado
  for select using (is_org_member(org_id));
-- Escrita só pelas RPCs (owner/admin), como no resto da Pauta.

create or replace function org_pauta_ignorar(p_org uuid, p_valor text)
returns void language plpgsql security definer set search_path to 'public' as $$
declare v_valor text := btrim(coalesce(p_valor, ''));
begin
  if not org_pauta_pode(p_org) then raise exception 'Acesso negado' using errcode = '42501'; end if;
  if v_valor = '' then raise exception 'Valor vazio'; end if;
  insert into org_pauta_ignorado (org_id, chave, valor, created_by)
  values (p_org, lower(v_valor), v_valor, auth.uid())
  on conflict (org_id, chave) do nothing;
end $$;
revoke execute on function org_pauta_ignorar(uuid, text) from public, anon, authenticated;
grant  execute on function org_pauta_ignorar(uuid, text) to authenticated;

create or replace function org_pauta_designorar(p_org uuid, p_valor text)
returns void language plpgsql security definer set search_path to 'public' as $$
begin
  if not org_pauta_pode(p_org) then raise exception 'Acesso negado' using errcode = '42501'; end if;
  delete from org_pauta_ignorado where org_id = p_org and chave = lower(btrim(coalesce(p_valor, '')));
end $$;
revoke execute on function org_pauta_designorar(uuid, text) from public, anon, authenticated;
grant  execute on function org_pauta_designorar(uuid, text) to authenticated;

-- ── org_pauta_uso: mesma régua, com a coluna `ignorado` ─────────────────────
drop function if exists org_pauta_uso(uuid);

create function org_pauta_uso(p_org uuid)
returns table (campo text, valor text, usos bigint, ultimo date, no_cadastro boolean, ignorado boolean)
language sql stable security definer set search_path to 'public' as $$
  with seg as (
    select lower(s.seg) as chave, s.seg, s.created_at
      from pauta_segmentos() s
     where s.org_id = p_org
  ),
  cad as (
    select o.campo, o.valor, o.ordem, lower(o.valor) as chave
      from org_pauta_opcao o where o.org_id = p_org
  ),
  ign as (
    select i.chave from org_pauta_ignorado i where i.org_id = p_org
  ),
  do_cadastro as (
    select c.campo, c.valor,
           count(s.chave)  as usos,
           max(s.created_at)::date as ultimo,
           false as no_cadastro,
           false as ignorado,
           c.ordem as ordem
      from cad c left join seg s on s.chave = c.chave
     group by c.campo, c.valor, c.ordem
  ),
  sugestao as (
    select null::text as campo,
           (array_agg(s.seg order by s.created_at desc))[1] as valor,
           count(*) as usos,
           max(s.created_at)::date as ultimo,
           true as no_cadastro,
           (s.chave in (select chave from ign)) as ignorado,
           0 as ordem
      from seg s
     where not exists (select 1 from cad c where c.chave = s.chave)
     group by s.chave
    having count(*) >= 2
  )
  select t.campo, t.valor, t.usos, t.ultimo, t.no_cadastro, t.ignorado
    from (select * from do_cadastro union all select * from sugestao) t
   where is_org_member(p_org)
   order by t.no_cadastro desc, t.ignorado, t.usos desc, t.campo nulls last, t.ordem, t.valor;
$$;
revoke execute on function org_pauta_uso(uuid) from public, anon, authenticated;
grant  execute on function org_pauta_uso(uuid) to authenticated;

notify pgrst, 'reload schema';
