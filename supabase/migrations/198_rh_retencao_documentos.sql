-- 198_rh_retencao_documentos.sql
-- Auditoria 02/08, RH: "Excluir documento sensível deixa o arquivo órfão no
-- volume para sempre".
--
-- `rh_delete_documento` apaga a linha e pronto — o PDF continua em
-- /app/uploads/rh-privado/ até o fim dos tempos. E não havia prazo nenhum: ASO,
-- atestado e holerite ficavam guardados indefinidamente.
--
-- Decisão do Rafael (03/08): **5 anos para todo tipo de documento**. Eu levantei
-- que ASO e atestado costumam ter prazo legal maior; ele confirmou o prazo único.
-- Fica configurável (`org_settings.rh_retencao_anos`) para mudar sem deploy se a
-- contabilidade disser outra coisa.
--
-- Medido: 52 documentos, o mais antigo de 30/07/2026 — nada expurgável antes de
-- 2031. Todo o efeito aqui é preventivo, o que também significa que o caminho
-- vai passar cinco anos sem ser exercitado: por isso o log abaixo, e por isso o
-- job faz o mesmo caminho que a exclusão manual.
--
-- Idempotente.

alter table org_settings add column if not exists rh_retencao_anos int not null default 5;

-- O que foi expurgado continua registrado: some o arquivo e o dado sensível,
-- fica a prova de que existiu e de quando saiu (é o que se apresenta numa
-- eventual fiscalização, e o que evita "sumiu, ninguém sabe explicar").
create table if not exists rh_documento_expurgo (
  id             uuid primary key default gen_random_uuid(),
  org_id         uuid not null references organizations(id) on delete cascade,
  colaborador_id uuid references rh_colaborador(id) on delete set null,
  documento_id   uuid not null,
  tipo           text,
  nome           text,
  chave          text,
  competencia    date,
  criado_em      timestamptz,
  expurgado_em   timestamptz not null default now(),
  expurgado_por  uuid,
  motivo         text not null default 'retencao'   -- retencao | manual
);
alter table rh_documento_expurgo enable row level security;
drop policy if exists rh_documento_expurgo_rh on rh_documento_expurgo;
create policy rh_documento_expurgo_rh on rh_documento_expurgo for select using (rh_can(org_id));

-- ── O que já passou do prazo ────────────────────────────────────────────────
-- Devolve a CHAVE porque quem apaga o arquivo é o Node (o Postgres não alcança
-- o volume). Sem org: o job varre todas as organizações.
create or replace function rh_documentos_expurgaveis(p_org uuid default null)
returns table(id uuid, org_id uuid, colaborador_id uuid, tipo text, nome text,
              chave text, competencia date, criado_em timestamptz)
language plpgsql stable security definer set search_path to 'public' as $$
begin
  if p_org is not null then
    if not rh_can(p_org) then raise exception 'Acesso negado' using errcode = '42501'; end if;
  elsif not (is_cron() or is_psql_direto()) then
    raise exception 'Acesso negado' using errcode = '42501';
  end if;

  return query
  select d.id, d.org_id, d.colaborador_id, d.tipo, d.nome, d.chave, d.competencia, d.created_at
    from rh_documento d
    join org_settings os on os.org_id = d.org_id
   where (p_org is null or d.org_id = p_org)
     and d.created_at < now() - make_interval(years => coalesce(os.rh_retencao_anos, 5))
   order by d.created_at;
end $$;

-- ── Registrar o expurgo e apagar a linha ────────────────────────────────────
-- Chamada DEPOIS que o arquivo já saiu do disco. Se o arquivo falhar, a linha
-- fica — melhor um documento a mais do que um registro sem arquivo e sem rastro.
create or replace function rh_expurgar_documento(p_id uuid, p_motivo text default 'retencao')
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare d rh_documento;
begin
  select * into d from rh_documento where id = p_id;
  if d.id is null then return jsonb_build_object('ok', false, 'motivo', 'não encontrado'); end if;
  if not (rh_can(d.org_id) or is_cron() or is_psql_direto()) then
    raise exception 'Acesso negado' using errcode = '42501';
  end if;

  insert into rh_documento_expurgo (org_id, colaborador_id, documento_id, tipo, nome, chave,
                                    competencia, criado_em, expurgado_por, motivo)
  values (d.org_id, d.colaborador_id, d.id, d.tipo, d.nome, d.chave,
          d.competencia, d.created_at, auth.uid(),
          case when p_motivo = 'manual' then 'manual' else 'retencao' end);

  delete from rh_documento where id = p_id;
  return jsonb_build_object('ok', true, 'chave', d.chave);
end $$;

-- A exclusão manual passa a valer pelo mesmo caminho: registra e some. Mantida a
-- assinatura antiga para não quebrar a tela enquanto ela migra.
create or replace function rh_delete_documento(p_id uuid)
returns void language plpgsql security definer set search_path to 'public' as $$
begin
  perform rh_expurgar_documento(p_id, 'manual');
end $$;

create or replace function rh_set_retencao(p_org uuid, p_anos int)
returns void language plpgsql security definer set search_path to 'public' as $$
begin
  if not rh_can(p_org) then raise exception 'Acesso negado' using errcode = '42501'; end if;
  if p_anos is null or p_anos < 1 or p_anos > 30 then
    raise exception 'Prazo de retenção deve ficar entre 1 e 30 anos';
  end if;
  insert into org_settings (org_id, rh_retencao_anos) values (p_org, p_anos)
  on conflict (org_id) do update set rh_retencao_anos = excluded.rh_retencao_anos;
end $$;

revoke execute on function rh_documentos_expurgaveis(uuid)   from public, anon;
revoke execute on function rh_expurgar_documento(uuid, text)  from public, anon;
revoke execute on function rh_delete_documento(uuid)          from public, anon;
revoke execute on function rh_set_retencao(uuid, int)         from public, anon;
grant  execute on function rh_documentos_expurgaveis(uuid)    to authenticated;
grant  execute on function rh_expurgar_documento(uuid, text)  to authenticated;
grant  execute on function rh_delete_documento(uuid)          to authenticated;
grant  execute on function rh_set_retencao(uuid, int)         to authenticated;

notify pgrst, 'reload schema';
