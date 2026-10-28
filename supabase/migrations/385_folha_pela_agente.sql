-- 385 — a Flávia lança a folha da Ocvel no Flow (28/10/2026)
--
-- Todo mês a Ocvel manda a folha por e-mail; o Rafael quer que a Flávia leia o PDF e
-- atualize os lançamentos de pagamento (o líquido de cada um, último dia útil) pelo
-- MESMO caminho da tela RH → Folha: importar (rh_importar_folha), conciliar
-- (rh_folha_plano) e aplicar (rh_folha_aplicar). Só muda a guarda: RH OU a usuária de
-- um agente com token vivo (fin_agente_folha, mig. 378). Aplicar só depois do Sim na mesa.

CREATE OR REPLACE FUNCTION public.rh_importar_folha(p_org_id uuid, p_competencia date, p_linhas jsonb, p_auto_criar boolean DEFAULT true)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  l jsonb; v_cpf text; v_nome text; v_colab uuid; v_id uuid;
  v_criados int := 0; v_casados int := 0; v_linhas int := 0; v_pend jsonb := '[]'::jsonb;
begin
  if not (rh_can(p_org_id) or fin_agente_folha(p_org_id)) then raise exception 'Acesso negado' using errcode = '42501'; end if;
  if p_competencia is null then raise exception 'Competência obrigatória'; end if;

  for l in select * from jsonb_array_elements(coalesce(p_linhas, '[]'::jsonb)) loop
    v_cpf := regexp_replace(coalesce(l->>'cpf',''), '[^0-9]', '', 'g');
    v_nome := nullif(btrim(coalesce(l->>'nome','')), '');
    v_colab := null;

    if v_cpf <> '' then
      select id into v_colab from rh_colaborador
        where org_id = p_org_id and regexp_replace(coalesce(cpf,''),'[^0-9]','','g') = v_cpf
        limit 1;
    end if;

    -- Sem CPF, tenta o nome antes de desistir: é o caso que antes virava ficha
    -- duplicada a cada importação.
    if v_colab is null and v_nome is not null then
      select id into v_colab from rh_colaborador
        where org_id = p_org_id
          and btrim(lower(unaccent(nome))) = btrim(lower(unaccent(v_nome)))
        limit 1;
    end if;

    if v_colab is not null then v_casados := v_casados + 1; end if;

    -- Auto-criar só com CPF. Sem CPF não dá para afirmar que é gente nova — e
    -- errar aqui cria uma segunda ficha da mesma pessoa, que depois contamina
    -- folha, ponto e custo/hora.
    if v_colab is null and p_auto_criar and v_nome is not null and v_cpf <> '' then
      insert into rh_colaborador (org_id, nome, cpf, cargo, tipo_vinculo, data_admissao, salario_atual, status, created_by)
      values (p_org_id, v_nome, nullif(l->>'cpf',''), nullif(l->>'cargo',''),
        rh_vinculo_da_categoria(l->>'categoria'), nullif(l->>'data_admissao','')::date,
        nullif(l->>'salario_base','')::numeric, 'ativo', auth.uid())
      returning id into v_colab;
      v_criados := v_criados + 1;
    end if;

    insert into rh_folha (org_id, colaborador_id, competencia, matricula, nome, cpf, cargo, categoria,
      salario_base, vencimentos, descontos, inss, irrf, fgts, vale_refeicao, faltas, liquido, detalhe, tratamento, created_by)
    values (p_org_id, v_colab, p_competencia, nullif(l->>'matricula',''), v_nome,
      nullif(l->>'cpf',''), nullif(l->>'cargo',''), nullif(l->>'categoria',''),
      nullif(l->>'salario_base','')::numeric, nullif(l->>'vencimentos','')::numeric,
      nullif(l->>'descontos','')::numeric, nullif(l->>'inss','')::numeric, nullif(l->>'irrf','')::numeric,
      nullif(l->>'fgts','')::numeric, nullif(l->>'vale_refeicao','')::numeric, nullif(l->>'faltas','')::numeric,
      nullif(l->>'liquido','')::numeric, l->'detalhe',
      case when l->>'tratamento' in ('salario','socio') then l->>'tratamento' end, auth.uid())
    on conflict (org_id, competencia, chave_pessoa) do update set
      colaborador_id = coalesce(excluded.colaborador_id, rh_folha.colaborador_id),
      matricula = excluded.matricula, nome = excluded.nome, cpf = coalesce(excluded.cpf, rh_folha.cpf),
      cargo = excluded.cargo, categoria = excluded.categoria, salario_base = excluded.salario_base,
      vencimentos = excluded.vencimentos, descontos = excluded.descontos, inss = excluded.inss,
      irrf = excluded.irrf, fgts = excluded.fgts, vale_refeicao = excluded.vale_refeicao,
      faltas = excluded.faltas, liquido = excluded.liquido, detalhe = excluded.detalhe,
      -- Reimportar sem escolha explícita PRESERVA a escolha anterior.
      tratamento = coalesce(excluded.tratamento, rh_folha.tratamento)
    returning id into v_id;
    v_linhas := v_linhas + 1;

    -- Linha que alguém já vinculou à mão numa importação anterior não volta a
    -- perguntar: o vínculo sobrevive ao reimport (o `on conflict` faz coalesce),
    -- e perguntar de novo todo mês é o tipo de ruído que faz ignorar o aviso.
    if v_colab is null then
      select colaborador_id into v_colab from rh_folha where id = v_id;
    end if;

    if v_colab is null then
      v_pend := v_pend || jsonb_build_object(
        'folha_id', v_id, 'nome', v_nome, 'cpf', nullif(l->>'cpf',''),
        'cargo', nullif(l->>'cargo',''), 'liquido', nullif(l->>'liquido','')::numeric);
    end if;

    if v_colab is not null and nullif(l->>'salario_base','') is not null then
      update rh_colaborador set salario_atual = (l->>'salario_base')::numeric, updated_at = now()
        where id = v_colab and salario_atual is distinct from (l->>'salario_base')::numeric;
    end if;
  end loop;

  return jsonb_build_object('linhas', v_linhas, 'criados', v_criados, 'casados', v_casados,
                            'pendentes', v_pend);
end $function$;

CREATE OR REPLACE FUNCTION public.rh_folha_plano(p_org_id uuid, p_competencia date)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_ini date := date_trunc('month', p_competencia)::date;
  v_fim date := (date_trunc('month', p_competencia) + interval '1 month' - interval '1 day')::date;
  v_prox_ini date := (date_trunc('month', p_competencia) + interval '1 month')::date;
  v_prox_fim date := (date_trunc('month', p_competencia) + interval '2 month' - interval '1 day')::date;
  v_comp text := to_char(p_competencia, 'YYYY-MM');
  v_salarios jsonb := '[]'::jsonb;
  v_socios jsonb := '[]'::jsonb;
  v_guias jsonb := '{}'::jsonb;
  v_palpite_inss numeric := 0; v_palpite_fgts numeric := 0;
  r record; v_lanc record; v_status text; v_nome text; g record;
begin
  if not (rh_can(p_org_id) or fin_agente_folha(p_org_id)) then raise exception 'Acesso negado' using errcode = '42501'; end if;

  for r in
    select f.colaborador_id, coalesce(c.nome, f.nome) as nome, f.liquido,
      coalesce(f.tratamento,
        case when rh_vinculo_da_categoria(f.categoria) = 'socio' then 'socio' else 'salario' end) as trat
    from rh_folha f
    left join rh_colaborador c on c.id = f.colaborador_id
    where f.org_id = p_org_id and f.competencia = p_competencia
    order by coalesce(c.nome, f.nome)
  loop
    -- Sócio (pró-labore): não recebe salário; entra só nas guias.
    if r.trat = 'socio' then
      v_socios := v_socios || jsonb_build_object('nome', r.nome);
      continue;
    end if;
    if coalesce(r.liquido, 0) <= 0 then continue; end if;
    v_nome := r.nome;

    -- Já existe o lançamento de folha desta pessoa nesta competência? → vinculado.
    select id, valor, vencimento, situacao into v_lanc
    from lancamentos
    where org_id = p_org_id and origem_tipo = 'folha'
      and origem_ref = 'folha:' || v_comp || ':pessoa:' || r.colaborador_id
    limit 1;

    if found then
      v_status := 'vinculado';
    else
      -- Busca o provisionado da pessoa no mês: saída, ainda não amarrado a folha,
      -- casando por nome ou valor (em aberto na frente).
      select id, valor, vencimento, situacao into v_lanc
      from lancamentos
      where org_id = p_org_id and tipo = 'saida'
        and coalesce(origem_tipo, '') <> 'folha'
        and vencimento between v_ini and v_fim
        and (
          (r.colaborador_id is not null and rh_norm(contato_nome) = rh_norm(v_nome))
          or round(coalesce(valor, 0), 2) = round(r.liquido, 2)
        )
      order by (rh_norm(contato_nome) = rh_norm(v_nome)) desc,
               (situacao = 'em_aberto') desc,
               abs(coalesce(valor, 0) - r.liquido) asc
      limit 1;
      v_status := case when found then 'achado' else 'novo' end;
    end if;

    v_salarios := v_salarios || jsonb_build_object(
      'colaborador_id', r.colaborador_id, 'nome', v_nome, 'liquido', r.liquido,
      'status', v_status,
      'lancamento_id', case when v_status = 'novo' then null else v_lanc.id end,
      'lanc_valor',    case when v_status = 'novo' then null else v_lanc.valor end,
      'lanc_venc',     case when v_status = 'novo' then null else v_lanc.vencimento end,
      'lanc_situacao', case when v_status = 'novo' then null else v_lanc.situacao end);
  end loop;

  -- Palpites das guias a partir da própria folha (inclui a parte dos sócios).
  select coalesce(sum(inss), 0) + coalesce(sum(irrf), 0), coalesce(sum(fgts), 0)
    into v_palpite_inss, v_palpite_fgts
  from rh_folha where org_id = p_org_id and competencia = p_competencia;

  -- Guias: acha o provisionado do dia 20 do mês seguinte (Darf/FGTS) p/ adotar.
  for g in
    select * from (values
      ('inss', array['%darf%', '%inss%', '%irrf%']),
      ('fgts', array['%fgts%'])
    ) as t(corrente, padroes)
  loop
    select id, valor, vencimento, situacao, descricao into v_lanc
    from lancamentos
    where org_id = p_org_id and origem_tipo = 'folha'
      and origem_ref = 'folha:' || v_comp || ':' || g.corrente
    limit 1;

    if found then
      v_status := 'vinculado';
    else
      select id, valor, vencimento, situacao, descricao into v_lanc
      from lancamentos l
      where l.org_id = p_org_id and l.tipo = 'saida' and l.situacao = 'em_aberto'
        and coalesce(l.origem_tipo, '') <> 'folha'
        and l.vencimento between v_prox_ini and v_prox_fim
        and exists (select 1 from unnest(g.padroes) p
                    where l.categoria ilike p or l.descricao ilike p)
        and l.categoria not ilike '%passivo%' and l.descricao not ilike '%parcelamento%'
      order by (l.categoria ilike g.padroes[1]) desc,
               abs(extract(day from l.vencimento) - 20) asc
      limit 1;
      v_status := case when found then 'achado' else 'novo' end;
    end if;

    v_guias := v_guias || jsonb_build_object(g.corrente, jsonb_build_object(
      'status', v_status,
      'lancamento_id', case when v_status = 'novo' then null else v_lanc.id end,
      'valor',         case when v_status = 'novo' then null else v_lanc.valor end,
      'venc',          case when v_status = 'novo' then null else v_lanc.vencimento end,
      'situacao',      case when v_status = 'novo' then null else v_lanc.situacao end,
      'descricao',     case when v_status = 'novo' then null else left(v_lanc.descricao, 60) end));
  end loop;

  return jsonb_build_object('competencia', v_comp, 'salarios', v_salarios, 'socios', v_socios,
    'guias', v_guias, 'palpite_inss', v_palpite_inss, 'palpite_fgts', v_palpite_fgts);
end; $function$;

CREATE OR REPLACE FUNCTION public.rh_folha_aplicar(p_org_id uuid, p_competencia date, p_salarios jsonb, p_inss numeric, p_venc_inss date, p_fgts numeric, p_venc_fgts date, p_inss_lanc uuid DEFAULT NULL::uuid, p_fgts_lanc uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_comp text := to_char(p_competencia, 'YYYY-MM');
  v_compbr text := to_char(p_competencia, 'MM/YYYY');
  v_vinc int := 0; v_cri int := 0; v_gui int := 0;
  v_centro text;
  s jsonb; v_ref text; v_val numeric; v_venc date; v_colab uuid; v_nome text; g record;
begin
  if not (rh_can(p_org_id) or fin_agente_folha(p_org_id)) then raise exception 'Acesso negado' using errcode = '42501'; end if;

  -- Centro de custo da folha = a própria agência (custo interno, não de cliente).
  select name into v_centro from organizations where id = p_org_id;

  -- Salários por pessoa
  for s in select * from jsonb_array_elements(coalesce(p_salarios, '[]'::jsonb))
  loop
    if (s->>'acao') = 'ignorar' then continue; end if;
    v_colab := nullif(s->>'colaborador_id', '')::uuid;
    v_nome  := coalesce(nullif(s->>'nome', ''), 'Colaborador');
    v_val   := nullif(s->>'valor', '')::numeric;
    v_venc  := nullif(s->>'venc', '')::date;
    v_ref   := 'folha:' || v_comp || ':pessoa:' || coalesce(v_colab::text, rh_norm(v_nome));

    if (s->>'acao') = 'vincular' and nullif(s->>'lancamento_id', '') is not null then
      -- Previsto vira realizado: carimba a origem E atualiza valor/venc pelo da
      -- folha — só em aberto. Pago não muda de valor (só ganha o carimbo).
      -- O centro só é preenchido quando está vazio: escolha de quem lançou manda.
      update lancamentos set
        origem_tipo = 'folha', origem_ref = v_ref, competencia = p_competencia,
        valor = coalesce(v_val, valor), vencimento = coalesce(v_venc, vencimento),
        categoria = coalesce(nullif(categoria, ''), 'Salários'),
        centro_custo = coalesce(nullif(centro_custo, ''), v_centro), updated_at = now()
      where id = (s->>'lancamento_id')::uuid and org_id = p_org_id
        and coalesce(origem_tipo, '') <> 'folha' and situacao = 'em_aberto';
      if found then
        v_vinc := v_vinc + 1;
      else
        update lancamentos set
          origem_tipo = 'folha', origem_ref = v_ref, competencia = p_competencia,
          categoria = coalesce(nullif(categoria, ''), 'Salários'),
          centro_custo = coalesce(nullif(centro_custo, ''), v_centro), updated_at = now()
        where id = (s->>'lancamento_id')::uuid and org_id = p_org_id
          and coalesce(origem_tipo, '') <> 'folha';
        if found then v_vinc := v_vinc + 1; end if;
      end if;

    elsif (s->>'acao') = 'criar' then
      perform 1 from lancamentos where org_id = p_org_id and origem_tipo = 'folha' and origem_ref = v_ref;
      if found then
        update lancamentos set valor = coalesce(v_val, valor), vencimento = coalesce(v_venc, vencimento),
          competencia = p_competencia,
          centro_custo = coalesce(nullif(centro_custo, ''), v_centro), updated_at = now()
        where org_id = p_org_id and origem_tipo = 'folha' and origem_ref = v_ref and situacao = 'em_aberto';
      else
        insert into lancamentos (org_id, tipo, origem_tipo, origem_ref, contato_tipo, contato_nome,
          descricao, valor, vencimento, competencia, situacao, categoria, centro_custo, forma_pagamento, created_by)
        values (p_org_id, 'saida', 'folha', v_ref, 'colaborador', v_nome,
          'Folha — Salário ' || v_nome || ' ' || v_compbr, coalesce(v_val, 0), v_venc, p_competencia,
          'em_aberto', 'Salários', v_centro, 'transferencia', auth.uid());
        v_cri := v_cri + 1;
      end if;
    end if;
  end loop;

  -- Guias (INSS/FGTS) — incluem a parte dos sócios. Se veio o provisionado
  -- (p_*_lanc), adota: carimba a origem e atualiza pro valor real da guia.
  for g in
    select * from (values
      ('inss', 'Encargos - INSS', 'Folha — INSS ' || v_compbr, p_inss, p_venc_inss, p_inss_lanc),
      ('fgts', 'Encargos - FGTS', 'Folha — FGTS ' || v_compbr, p_fgts, p_venc_fgts, p_fgts_lanc)
    ) as t(corrente, categoria, descricao, valor, venc, lanc_id)
  loop
    if coalesce(g.valor, 0) <= 0 or g.venc is null then continue; end if;
    v_ref := 'folha:' || v_comp || ':' || g.corrente;

    if g.lanc_id is not null then
      -- Mantém a descrição/categoria do provisionado do Rafael; só valor/venc/origem.
      update lancamentos set origem_tipo = 'folha', origem_ref = v_ref,
        valor = g.valor, vencimento = g.venc, competencia = p_competencia,
        centro_custo = coalesce(nullif(centro_custo, ''), v_centro), updated_at = now()
      where id = g.lanc_id and org_id = p_org_id and situacao = 'em_aberto'
        and (coalesce(origem_tipo, '') <> 'folha' or origem_ref = v_ref);
      if found then v_gui := v_gui + 1; continue; end if;
    end if;

    perform 1 from lancamentos where org_id = p_org_id and origem_tipo = 'folha' and origem_ref = v_ref;
    if found then
      update lancamentos set valor = g.valor, vencimento = g.venc, competencia = p_competencia,
        descricao = g.descricao, categoria = g.categoria,
        centro_custo = coalesce(nullif(centro_custo, ''), v_centro), updated_at = now()
      where org_id = p_org_id and origem_tipo = 'folha' and origem_ref = v_ref and situacao = 'em_aberto';
    else
      insert into lancamentos (org_id, tipo, origem_tipo, origem_ref, contato_tipo, contato_nome,
        descricao, valor, vencimento, competencia, situacao, categoria, centro_custo, forma_pagamento, created_by)
      values (p_org_id, 'saida', 'folha', v_ref, 'outro', 'Folha de pagamento',
        g.descricao, g.valor, g.venc, p_competencia, 'em_aberto', g.categoria, v_centro, 'transferencia', auth.uid());
    end if;
    v_gui := v_gui + 1;
  end loop;

  return jsonb_build_object('vinculados', v_vinc, 'criados', v_cri, 'guias', v_gui);
end; $function$;

notify pgrst, 'reload schema';
