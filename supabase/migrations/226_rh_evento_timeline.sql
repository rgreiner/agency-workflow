-- 226_rh_evento_timeline.sql
-- A entidade que estava no blueprint de 22/07 e nunca foi construída: a linha do
-- tempo da pessoa. Promoção, reajuste, feedback, advertência, afastamento.
--
-- Sem ela o painel mostrava QUANTO alguém custa e COMO foi avaliado, mas não o
-- que aconteceu com a pessoa — salário mudava sozinho, sem promoção que
-- explicasse.
--
-- ⭐ `data_efeito` ≠ `created_at`, e é isso que permite ajustar o histórico:
-- a convenção do sindicato tem data-base em MAIO e costuma sair até AGOSTO.
-- Registrar em agosto com efeito em maio é o caso normal, não a exceção — daí
-- o retroativo dos meses já pagos a menor, que a RPC calcula.
--
-- O reajuste coletivo grava UM evento POR PESSOA (não um consolidado), como já
-- foi decidido na folha: o histórico é da pessoa, e o `lote_id` amarra quem saiu
-- da mesma convenção.
--
-- Idempotente.

create table if not exists rh_evento (
  id             uuid primary key default gen_random_uuid(),
  org_id         uuid not null references organizations(id) on delete cascade,
  colaborador_id uuid not null references rh_colaborador(id) on delete cascade,
  tipo           text not null,          -- promocao|reajuste|feedback|advertencia|afastamento|retorno|cargo|outro
  -- Quando o fato VALE (maio). O `created_at` guarda quando foi registrado (agosto).
  data_efeito    date not null,
  titulo         text,
  descricao      text,
  -- Eventos de dinheiro: guarda o antes e o depois, senão o histórico não
  -- reconstrói a evolução salarial.
  salario_de     numeric,
  salario_para   numeric,
  percentual     numeric,
  cargo_de       text,
  cargo_para     text,
  -- Amarra as pessoas que saíram do mesmo reajuste coletivo.
  lote_id        uuid,
  doc_id         uuid references rh_documento(id) on delete set null,
  registrado_por uuid,
  created_at     timestamptz not null default now()
);
create index if not exists rh_evento_colab_idx on rh_evento (colaborador_id, data_efeito desc);
create index if not exists rh_evento_lote_idx  on rh_evento (lote_id) where lote_id is not null;

alter table rh_evento enable row level security;
drop policy if exists rh_evento_rw on rh_evento;
create policy rh_evento_rw on rh_evento for all using (rh_can(org_id)) with check (rh_can(org_id));

-- ── Salvar um evento avulso ─────────────────────────────────────────────────
create or replace function rh_evento_salvar(p_org uuid, p_id uuid, p_dados jsonb)
returns uuid language plpgsql security definer set search_path to 'public' as $$
declare v_id uuid; v_colab uuid; v_tipo text; v_efeito date; v_para numeric;
begin
  if not rh_can(p_org) then raise exception 'Acesso negado' using errcode = '42501'; end if;
  v_colab  := (p_dados->>'colaborador_id')::uuid;
  v_tipo   := coalesce(p_dados->>'tipo', 'outro');
  v_efeito := (p_dados->>'data_efeito')::date;
  if v_colab is null then raise exception 'Informe a pessoa'; end if;
  if v_efeito is null then raise exception 'Informe a data de vigência'; end if;
  if not exists (select 1 from rh_colaborador where id = v_colab and org_id = p_org) then
    raise exception 'Pessoa de outra organização';
  end if;

  if p_id is null then
    insert into rh_evento (org_id, colaborador_id, tipo, data_efeito, titulo, descricao,
                           salario_de, salario_para, percentual, cargo_de, cargo_para,
                           doc_id, registrado_por)
    values (p_org, v_colab, v_tipo, v_efeito,
            nullif(btrim(coalesce(p_dados->>'titulo','')), ''),
            nullif(btrim(coalesce(p_dados->>'descricao','')), ''),
            nullif(p_dados->>'salario_de','')::numeric,
            nullif(p_dados->>'salario_para','')::numeric,
            nullif(p_dados->>'percentual','')::numeric,
            nullif(btrim(coalesce(p_dados->>'cargo_de','')), ''),
            nullif(btrim(coalesce(p_dados->>'cargo_para','')), ''),
            nullif(p_dados->>'doc_id','')::uuid, auth.uid())
    returning id into v_id;
  else
    update rh_evento set
      tipo = v_tipo, data_efeito = v_efeito,
      titulo = nullif(btrim(coalesce(p_dados->>'titulo','')), ''),
      descricao = nullif(btrim(coalesce(p_dados->>'descricao','')), ''),
      salario_de = nullif(p_dados->>'salario_de','')::numeric,
      salario_para = nullif(p_dados->>'salario_para','')::numeric,
      percentual = nullif(p_dados->>'percentual','')::numeric,
      cargo_de = nullif(btrim(coalesce(p_dados->>'cargo_de','')), ''),
      cargo_para = nullif(btrim(coalesce(p_dados->>'cargo_para','')), '')
    where id = p_id and org_id = p_org
    returning id into v_id;
    if v_id is null then raise exception 'Evento não encontrado'; end if;
  end if;

  -- Evento de dinheiro/cargo atualiza a ficha — mas só se for o MAIS RECENTE em
  -- vigência: lançar uma promoção antiga depois de uma nova não pode rebaixar
  -- o salário atual da pessoa.
  v_para := nullif(p_dados->>'salario_para','')::numeric;
  if v_para is not null and not exists (
       select 1 from rh_evento e
        where e.colaborador_id = v_colab and e.salario_para is not null
          and e.id <> v_id and e.data_efeito > v_efeito)
  then
    update rh_colaborador set salario_atual = v_para, updated_at = now() where id = v_colab;
  end if;
  if nullif(btrim(coalesce(p_dados->>'cargo_para','')), '') is not null then
    update rh_colaborador set cargo = p_dados->>'cargo_para', updated_at = now()
     where id = v_colab
       and not exists (select 1 from rh_evento e where e.colaborador_id = v_colab
                        and e.cargo_para is not null and e.id <> v_id and e.data_efeito > v_efeito);
  end if;

  return v_id;
end $$;
revoke execute on function rh_evento_salvar(uuid, uuid, jsonb) from public, anon;
grant  execute on function rh_evento_salvar(uuid, uuid, jsonb) to authenticated;

create or replace function rh_evento_excluir(p_id uuid)
returns void language plpgsql security definer set search_path to 'public' as $$
declare v_org uuid;
begin
  select org_id into v_org from rh_evento where id = p_id;
  if v_org is null then raise exception 'Evento não encontrado'; end if;
  if not rh_can(v_org) then raise exception 'Acesso negado' using errcode = '42501'; end if;
  delete from rh_evento where id = p_id;
end $$;
revoke execute on function rh_evento_excluir(uuid) from public, anon;
grant  execute on function rh_evento_excluir(uuid) to authenticated;

-- ── Prévia do reajuste coletivo (não grava) ─────────────────────────────────
-- Mostra pessoa a pessoa o valor novo e o retroativo antes de aplicar. O
-- retroativo conta os meses ENTRE a vigência e o mês do registro: convenção com
-- data-base em maio, aplicada em agosto, deve maio, junho e julho — agosto já
-- sai na folha corrigida.
create or replace function rh_reajuste_previa(
  p_org uuid, p_data_efeito date, p_percentual numeric, p_pessoas jsonb default null)
returns jsonb language plpgsql stable security definer set search_path to 'public' as $$
declare v_meses int; v_hoje date;
begin
  if not rh_can(p_org) then raise exception 'Acesso negado' using errcode = '42501'; end if;
  if p_data_efeito is null then raise exception 'Informe a data-base'; end if;
  v_hoje  := (now() at time zone 'America/Sao_Paulo')::date;
  v_meses := greatest(0,
    (extract(year from v_hoje)::int * 12 + extract(month from v_hoje)::int)
  - (extract(year from p_data_efeito)::int * 12 + extract(month from p_data_efeito)::int));

  return jsonb_build_object(
    'data_efeito', p_data_efeito,
    'percentual', p_percentual,
    'meses_retroativos', v_meses,
    'pessoas', coalesce((
      select jsonb_agg(jsonb_build_object(
        'colaborador_id', c.id, 'nome', c.nome, 'cargo', c.cargo,
        'salario_de', c.salario_atual,
        'salario_para', round(c.salario_atual * (1 + coalesce(p_percentual, 0) / 100), 2),
        'diferenca', round(c.salario_atual * coalesce(p_percentual, 0) / 100, 2),
        'retroativo', round(c.salario_atual * coalesce(p_percentual, 0) / 100 * v_meses, 2))
        order by c.nome)
        from rh_colaborador c
       where c.org_id = p_org and c.status = 'ativo' and not c.arquivado
         and c.salario_atual is not null and c.salario_atual > 0
         and (p_pessoas is null
              or c.id in (select (jsonb_array_elements_text(p_pessoas))::uuid))), '[]'::jsonb));
end $$;
revoke execute on function rh_reajuste_previa(uuid, date, numeric, jsonb) from public, anon;
grant  execute on function rh_reajuste_previa(uuid, date, numeric, jsonb) to authenticated;

-- ── Aplicar o reajuste coletivo ─────────────────────────────────────────────
-- Um evento POR PESSOA (o histórico é da pessoa), amarrados por `lote_id`.
create or replace function rh_reajuste_aplicar(
  p_org uuid, p_data_efeito date, p_percentual numeric, p_titulo text, p_pessoas jsonb default null)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare v_lote uuid := gen_random_uuid(); r record; v_n int := 0; v_novo numeric; v_retro numeric := 0;
        v_meses int; v_hoje date;
begin
  if not rh_can(p_org) then raise exception 'Acesso negado' using errcode = '42501'; end if;
  if p_data_efeito is null then raise exception 'Informe a data-base'; end if;
  if coalesce(p_percentual, 0) = 0 then raise exception 'Informe o percentual do reajuste'; end if;

  v_hoje  := (now() at time zone 'America/Sao_Paulo')::date;
  v_meses := greatest(0,
    (extract(year from v_hoje)::int * 12 + extract(month from v_hoje)::int)
  - (extract(year from p_data_efeito)::int * 12 + extract(month from p_data_efeito)::int));

  for r in
    select c.id, c.nome, c.salario_atual
      from rh_colaborador c
     where c.org_id = p_org and c.status = 'ativo' and not c.arquivado
       and c.salario_atual is not null and c.salario_atual > 0
       and (p_pessoas is null or c.id in (select (jsonb_array_elements_text(p_pessoas))::uuid))
  loop
    v_novo  := round(r.salario_atual * (1 + p_percentual / 100), 2);
    v_retro := v_retro + round((v_novo - r.salario_atual) * v_meses, 2);

    insert into rh_evento (org_id, colaborador_id, tipo, data_efeito, titulo,
                           salario_de, salario_para, percentual, lote_id, registrado_por)
    values (p_org, r.id, 'reajuste', p_data_efeito,
            coalesce(nullif(btrim(coalesce(p_titulo, '')), ''), 'Reajuste coletivo'),
            r.salario_atual, v_novo, p_percentual, v_lote, auth.uid());

    update rh_colaborador set salario_atual = v_novo, updated_at = now() where id = r.id;
    v_n := v_n + 1;
  end loop;

  if v_n = 0 then raise exception 'Ninguém elegível: confira se as pessoas têm salário na ficha.'; end if;

  return jsonb_build_object('lote_id', v_lote, 'pessoas', v_n,
                            'meses_retroativos', v_meses, 'retroativo_total', v_retro);
end $$;
revoke execute on function rh_reajuste_aplicar(uuid, date, numeric, text, jsonb) from public, anon;
grant  execute on function rh_reajuste_aplicar(uuid, date, numeric, text, jsonb) to authenticated;

-- ── Desfazer um lote (errou o percentual, aplicou na data errada) ────────────
create or replace function rh_reajuste_desfazer(p_lote uuid)
returns int language plpgsql security definer set search_path to 'public' as $$
declare v_org uuid; r record; v_n int := 0;
begin
  select org_id into v_org from rh_evento where lote_id = p_lote limit 1;
  if v_org is null then raise exception 'Lote não encontrado'; end if;
  if not rh_can(v_org) then raise exception 'Acesso negado' using errcode = '42501'; end if;

  -- Devolve o salário anterior só de quem não teve mudança POSTERIOR ao lote:
  -- desfazer não pode atropelar uma promoção que veio depois.
  for r in select colaborador_id, salario_de, data_efeito from rh_evento where lote_id = p_lote loop
    update rh_colaborador set salario_atual = r.salario_de, updated_at = now()
     where id = r.colaborador_id
       and not exists (select 1 from rh_evento e
                        where e.colaborador_id = r.colaborador_id and e.salario_para is not null
                          and e.lote_id is distinct from p_lote and e.data_efeito > r.data_efeito);
    v_n := v_n + 1;
  end loop;

  delete from rh_evento where lote_id = p_lote;
  return v_n;
end $$;
revoke execute on function rh_reajuste_desfazer(uuid) from public, anon;
grant  execute on function rh_reajuste_desfazer(uuid) to authenticated;

-- ── Timeline de uma pessoa ──────────────────────────────────────────────────
create or replace function rh_timeline(p_colaborador uuid)
returns jsonb language plpgsql stable security definer set search_path to 'public' as $$
declare v_org uuid;
begin
  select org_id into v_org from rh_colaborador where id = p_colaborador;
  if v_org is null then raise exception 'Pessoa não encontrada'; end if;
  if not rh_can(v_org) then raise exception 'Acesso negado' using errcode = '42501'; end if;

  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', e.id, 'tipo', e.tipo, 'data_efeito', e.data_efeito,
      'titulo', e.titulo, 'descricao', e.descricao,
      'salario_de', e.salario_de, 'salario_para', e.salario_para, 'percentual', e.percentual,
      'cargo_de', e.cargo_de, 'cargo_para', e.cargo_para,
      'lote_id', e.lote_id, 'doc_id', e.doc_id,
      -- Registrado depois da vigência = ajuste de histórico (o caso da convenção).
      'retroativo', e.created_at::date > e.data_efeito,
      'registrado_em', e.created_at,
      'por', (select pr.full_name from profiles pr where pr.id = e.registrado_por))
      order by e.data_efeito desc, e.created_at desc)
      from rh_evento e where e.colaborador_id = p_colaborador), '[]'::jsonb);
end $$;
revoke execute on function rh_timeline(uuid) from public, anon;
grant  execute on function rh_timeline(uuid) to authenticated;

notify pgrst, 'reload schema';
