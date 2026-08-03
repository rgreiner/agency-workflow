-- 169_rh_assinatura_espelho.sql
-- Assinatura eletrônica AVANÇADA do espelho de ponto (Lei 14.063/2020, art. 4º, II).
-- NÃO é assinatura qualificada (ICP-Brasil) — é ciência rastreável, apoiada na
-- MP 2.200-2/2001 art. 10 §2º: vale porque as partes acordam previamente que vale
-- (por isso o TERMO DE ADESÃO assinado uma vez).
--
-- O que dá valor probatório (Súmula 338 TST torna isso protetivo p/ a empresa):
--   QUEM   → user autenticado + reautenticação por senha no ato (controle exclusivo)
--   O QUÊ  → hash SHA-256 do snapshot canônico do ciclo, congelado em jsonb
--   QUANDO → hora do SERVIDOR (nunca do cliente)
--   PROVA  → IP + user-agent + trilha de tudo que ocorreu no ciclo (rh_ponto_log)
--
-- Assinado, o ciclo TRAVA: rh_editar_ponto passa a recusar. Reabrir exige motivo e
-- invalida a assinatura (fica no histórico, nunca é apagada).
-- Idempotente.

create table if not exists rh_assinatura (
  id             uuid primary key default gen_random_uuid(),
  org_id         uuid not null references organizations(id) on delete cascade,
  colaborador_id uuid not null references rh_colaborador(id) on delete cascade,
  tipo           text not null,                 -- termo_adesao | espelho
  competencia    date,                          -- null p/ termo_adesao
  hash           text not null,                 -- SHA-256 do snapshot canônico
  conteudo       jsonb,                         -- snapshot congelado (o que foi assinado)
  papel          text not null default 'colaborador',  -- colaborador | empresa
  assinado_por   uuid not null,                 -- auth.users.id de quem assinou
  assinado_em    timestamptz not null default now(),
  ip             text,
  user_agent     text,
  invalidada_em  timestamptz,                   -- preenchido ao reabrir o ciclo
  invalidada_por uuid,
  invalidada_motivo text
);
create index if not exists rh_assinatura_colab_idx on rh_assinatura (colaborador_id, tipo, competencia);
-- Uma assinatura VÁLIDA por papel/competência (a invalidada continua no histórico).
create unique index if not exists rh_assinatura_uk
  on rh_assinatura (colaborador_id, tipo, competencia, papel) where invalidada_em is null;

alter table rh_assinatura enable row level security;
drop policy if exists rh_assinatura_rw on rh_assinatura;
create policy rh_assinatura_rw on rh_assinatura for all
  using (rh_can(org_id) or rh_is_self(colaborador_id))
  with check (rh_can(org_id) or rh_is_self(colaborador_id));

-- ── Termo de adesão (uma vez por pessoa) ──
create or replace function rh_assinar_termo(
  p_colaborador_id uuid, p_hash text, p_texto text, p_ip text, p_ua text
) returns uuid language plpgsql security definer set search_path to 'public' as $$
declare v_org uuid; v_id uuid;
begin
  select org_id into v_org from rh_colaborador where id = p_colaborador_id;
  if v_org is null then raise exception 'Colaborador não encontrado'; end if;
  -- O termo é pessoal e intransferível: só o próprio assina.
  if not rh_is_self(p_colaborador_id) then
    raise exception 'O termo de adesão só pode ser assinado pelo próprio colaborador' using errcode = '42501';
  end if;
  if exists (select 1 from rh_assinatura where colaborador_id = p_colaborador_id
              and tipo = 'termo_adesao' and invalidada_em is null) then
    raise exception 'Termo já assinado';
  end if;

  insert into rh_assinatura (org_id, colaborador_id, tipo, competencia, hash, conteudo,
                             papel, assinado_por, ip, user_agent)
  values (v_org, p_colaborador_id, 'termo_adesao', null, p_hash,
          jsonb_build_object('texto', p_texto), 'colaborador', auth.uid(), p_ip, p_ua)
  returning id into v_id;
  return v_id;
end; $$;
revoke execute on function rh_assinar_termo(uuid, text, text, text, text) from public;
grant execute on function rh_assinar_termo(uuid, text, text, text, text) to authenticated;

-- ── Assinatura do espelho de uma competência ──
create or replace function rh_assinar_espelho(
  p_colaborador_id uuid, p_competencia date, p_hash text, p_conteudo jsonb,
  p_papel text, p_ip text, p_ua text
) returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare v_org uuid; v_id uuid;
begin
  select org_id into v_org from rh_colaborador where id = p_colaborador_id;
  if v_org is null then raise exception 'Colaborador não encontrado'; end if;

  if p_papel = 'colaborador' then
    if not rh_is_self(p_colaborador_id) then
      raise exception 'Só o próprio colaborador assina o espelho dele' using errcode = '42501';
    end if;
    -- Sem termo de adesão a assinatura eletrônica não tem o acordo prévio da MP 2.200-2.
    if not exists (select 1 from rh_assinatura where colaborador_id = p_colaborador_id
                    and tipo = 'termo_adesao' and invalidada_em is null) then
      raise exception 'Assine primeiro o termo de adesão à assinatura eletrônica';
    end if;
  elsif p_papel = 'empresa' then
    if not rh_can(v_org) then raise exception 'Acesso negado' using errcode = '42501'; end if;
  else
    raise exception 'Papel inválido';
  end if;

  if exists (select 1 from rh_assinatura where colaborador_id = p_colaborador_id and tipo = 'espelho'
              and competencia = p_competencia and papel = p_papel and invalidada_em is null) then
    raise exception 'Esta competência já foi assinada';
  end if;

  insert into rh_assinatura (org_id, colaborador_id, tipo, competencia, hash, conteudo,
                             papel, assinado_por, ip, user_agent)
  values (v_org, p_colaborador_id, 'espelho', p_competencia, p_hash, p_conteudo,
          p_papel, auth.uid(), p_ip, p_ua)
  returning id into v_id;

  return jsonb_build_object('id', v_id, 'papel', p_papel, 'hash', p_hash);
end; $$;
revoke execute on function rh_assinar_espelho(uuid, date, text, jsonb, text, text, text) from public;
grant execute on function rh_assinar_espelho(uuid, date, text, jsonb, text, text, text) to authenticated;

-- ── Reabrir o ciclo: invalida a assinatura (não apaga) e libera a edição ──
create or replace function rh_reabrir_ciclo(p_colaborador_id uuid, p_competencia date, p_motivo text)
returns int language plpgsql security definer set search_path to 'public' as $$
declare v_org uuid; v_n int;
begin
  select org_id into v_org from rh_colaborador where id = p_colaborador_id;
  if v_org is null then raise exception 'Colaborador não encontrado'; end if;
  if not rh_can(v_org) then raise exception 'Acesso negado' using errcode = '42501'; end if;
  if coalesce(btrim(p_motivo), '') = '' then raise exception 'Informe o motivo da reabertura'; end if;

  update rh_assinatura set invalidada_em = now(), invalidada_por = auth.uid(),
                           invalidada_motivo = btrim(p_motivo)
   where colaborador_id = p_colaborador_id and tipo = 'espelho'
     and competencia = p_competencia and invalidada_em is null;
  get diagnostics v_n = row_count;
  return v_n;
end; $$;
revoke execute on function rh_reabrir_ciclo(uuid, date, text) from public;
grant execute on function rh_reabrir_ciclo(uuid, date, text) to authenticated;

-- ── Ciclo assinado TRAVA a edição do dia ──
create or replace function rh_editar_ponto(
  p_org_id uuid, p_colaborador_id uuid, p_data date, p_horas jsonb, p_motivo text
) returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare p rh_ponto; v_antes jsonb; v_h text; v_i int := 0; v_comp date; v_ini date; v_fim date;
begin
  if not rh_can(p_org_id) then raise exception 'Acesso negado' using errcode = '42501'; end if;
  if coalesce(btrim(p_motivo), '') = '' then raise exception 'Informe o motivo da alteração'; end if;

  -- A competência a que o dia pertence depende do ciclo configurado (ex.: 26→25).
  select c.competencia into v_comp from (
    select (date_trunc('month', p_data) + interval '1 month')::date as competencia
    union all select date_trunc('month', p_data)::date
  ) c(competencia)
  join lateral rh_periodo_fechamento(p_org_id, c.competencia) r on true
  where p_data between r.ini and r.fim
  limit 1;

  if v_comp is not null and exists (
      select 1 from rh_assinatura a where a.colaborador_id = p_colaborador_id and a.tipo = 'espelho'
        and a.competencia = v_comp and a.invalidada_em is null)
  then
    raise exception 'Competência % já assinada. Reabra o ciclo para editar.', to_char(v_comp, 'MM/YYYY');
  end if;

  insert into rh_ponto (org_id, colaborador_id, data) values (p_org_id, p_colaborador_id, p_data)
    on conflict (colaborador_id, data) do nothing;
  select * into p from rh_ponto where colaborador_id = p_colaborador_id and data = p_data;
  if p.org_id <> p_org_id then raise exception 'Registro de outra organização'; end if;
  if p.origem is not null then
    raise exception 'Dia importado do %. Histórico importado não é editável.', p.origem;
  end if;

  select coalesce(jsonb_agg(to_char(hora, 'HH24:MI') order by seq), '[]'::jsonb)
    into v_antes from rh_marcacao where ponto_id = p.id;

  delete from rh_marcacao where ponto_id = p.id;
  for v_h in select jsonb_array_elements_text(coalesce(p_horas, '[]'::jsonb)) loop
    v_i := v_i + 1;
    insert into rh_marcacao (ponto_id, hora, seq, origem) values (p.id, v_h::time, v_i, 'ajuste');
  end loop;

  update rh_ponto set
    ajuste_de = coalesce(ajuste_de, jsonb_build_object('marcacoes', v_antes)),
    ajuste_por = auth.uid(), ajuste_em = now(), updated_at = now()
  where id = p.id;

  insert into rh_ponto_log (ponto_id, org_id, acao, antes, depois, motivo, por)
  values (p.id, p_org_id, 'edicao_rh', v_antes, coalesce(p_horas, '[]'::jsonb), btrim(p_motivo), auth.uid());

  perform rh_recalc_ponto(p.id);
  select * into p from rh_ponto where id = p.id;
  return jsonb_build_object('minutos', p.minutos, 'saldo_min', p.saldo_min,
    'intervalo_maior_min', p.intervalo_maior_min, 'intervalo_ok', p.intervalo_ok);
end; $$;
revoke execute on function rh_editar_ponto(uuid, uuid, date, jsonb, text) from public;
grant execute on function rh_editar_ponto(uuid, uuid, date, jsonb, text) to authenticated;

-- ── Assinaturas de uma competência (p/ as telas) ──
create or replace function rh_assinaturas(p_colaborador_id uuid, p_competencia date)
returns jsonb language plpgsql stable security definer set search_path to 'public' as $$
declare v_org uuid;
begin
  select org_id into v_org from rh_colaborador where id = p_colaborador_id;
  if not (rh_can(v_org) or rh_is_self(p_colaborador_id)) then
    raise exception 'Acesso negado' using errcode = '42501';
  end if;
  return jsonb_build_object(
    'termo', (select jsonb_build_object('assinado_em', a.assinado_em, 'hash', a.hash)
                from rh_assinatura a where a.colaborador_id = p_colaborador_id
                 and a.tipo = 'termo_adesao' and a.invalidada_em is null limit 1),
    'espelho', (select coalesce(jsonb_agg(jsonb_build_object(
                  'papel', a.papel, 'hash', a.hash, 'assinado_em', a.assinado_em,
                  'por', (select pr.full_name from profiles pr where pr.id = a.assinado_por),
                  'ip', a.ip)), '[]'::jsonb)
                from rh_assinatura a where a.colaborador_id = p_colaborador_id and a.tipo = 'espelho'
                 and a.competencia = p_competencia and a.invalidada_em is null),
    'historico', (select coalesce(jsonb_agg(jsonb_build_object(
                    'papel', a.papel, 'assinado_em', a.assinado_em, 'invalidada_em', a.invalidada_em,
                    'motivo', a.invalidada_motivo) order by a.assinado_em desc), '[]'::jsonb)
                  from rh_assinatura a where a.colaborador_id = p_colaborador_id and a.tipo = 'espelho'
                   and a.competencia = p_competencia and a.invalidada_em is not null));
end; $$;
revoke execute on function rh_assinaturas(uuid, date) from public;
grant execute on function rh_assinaturas(uuid, date) to authenticated;

notify pgrst, 'reload schema';
