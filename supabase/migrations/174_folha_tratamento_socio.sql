-- 174_folha_tratamento_socio.sql
-- Quem vira remuneração no Financeiro deixa de ser mágica da categoria (722) e
-- passa a ser ESCOLHA por linha na conferência da importação: select "Salário" ×
-- "Sócio (pró-labore)" gravado em rh_folha.tratamento. Linhas antigas (null)
-- continuam na heurística da categoria (rh_vinculo_da_categoria). Idempotente.

alter table rh_folha add column if not exists tratamento text
  check (tratamento in ('salario', 'socio'));

-- ── rh_importar_folha: grava o tratamento escolhido na conferência ──
create or replace function rh_importar_folha(p_org_id uuid, p_competencia date, p_linhas jsonb, p_auto_criar boolean default true)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare
  l jsonb; v_cpf text; v_colab uuid; v_criados int := 0; v_casados int := 0; v_linhas int := 0;
begin
  if not rh_can(p_org_id) then raise exception 'Acesso negado' using errcode = '42501'; end if;
  if p_competencia is null then raise exception 'Competência obrigatória'; end if;

  for l in select * from jsonb_array_elements(coalesce(p_linhas, '[]'::jsonb)) loop
    v_cpf := regexp_replace(coalesce(l->>'cpf',''), '[^0-9]', '', 'g');  -- só dígitos p/ casar
    v_colab := null;

    if v_cpf <> '' then
      select id into v_colab from rh_colaborador
        where org_id = p_org_id and regexp_replace(coalesce(cpf,''),'[^0-9]','','g') = v_cpf
        limit 1;
      if v_colab is not null then v_casados := v_casados + 1; end if;
    end if;

    -- Cria a ficha se não existe (a folha bootstrapa o cadastro).
    if v_colab is null and p_auto_criar and coalesce(nullif(l->>'nome',''),'') <> '' then
      insert into rh_colaborador (org_id, nome, cpf, cargo, tipo_vinculo, data_admissao, salario_atual, status, created_by)
      values (p_org_id, l->>'nome', nullif(l->>'cpf',''), nullif(l->>'cargo',''),
        rh_vinculo_da_categoria(l->>'categoria'), nullif(l->>'data_admissao','')::date,
        nullif(l->>'salario_base','')::numeric, 'ativo', auth.uid())
      returning id into v_colab;
      v_criados := v_criados + 1;
    end if;

    insert into rh_folha (org_id, colaborador_id, competencia, matricula, nome, cpf, cargo, categoria,
      salario_base, vencimentos, descontos, inss, irrf, fgts, vale_refeicao, faltas, liquido, detalhe, tratamento, created_by)
    values (p_org_id, v_colab, p_competencia, nullif(l->>'matricula',''), nullif(l->>'nome',''),
      nullif(l->>'cpf',''), nullif(l->>'cargo',''), nullif(l->>'categoria',''),
      nullif(l->>'salario_base','')::numeric, nullif(l->>'vencimentos','')::numeric,
      nullif(l->>'descontos','')::numeric, nullif(l->>'inss','')::numeric, nullif(l->>'irrf','')::numeric,
      nullif(l->>'fgts','')::numeric, nullif(l->>'vale_refeicao','')::numeric, nullif(l->>'faltas','')::numeric,
      nullif(l->>'liquido','')::numeric, l->'detalhe',
      case when l->>'tratamento' in ('salario','socio') then l->>'tratamento' end, auth.uid())
    on conflict (org_id, competencia, cpf) do update set
      colaborador_id = excluded.colaborador_id, matricula = excluded.matricula, nome = excluded.nome,
      cargo = excluded.cargo, categoria = excluded.categoria, salario_base = excluded.salario_base,
      vencimentos = excluded.vencimentos, descontos = excluded.descontos, inss = excluded.inss,
      irrf = excluded.irrf, fgts = excluded.fgts, vale_refeicao = excluded.vale_refeicao,
      faltas = excluded.faltas, liquido = excluded.liquido, detalhe = excluded.detalhe,
      -- Reimportar sem escolha explícita PRESERVA a escolha anterior.
      tratamento = coalesce(excluded.tratamento, rh_folha.tratamento);
    v_linhas := v_linhas + 1;

    -- Mantém o salário atual da ficha em dia com a folha.
    if v_colab is not null and nullif(l->>'salario_base','') is not null then
      update rh_colaborador set salario_atual = (l->>'salario_base')::numeric, updated_at = now()
        where id = v_colab and salario_atual is distinct from (l->>'salario_base')::numeric;
    end if;
  end loop;

  return jsonb_build_object('linhas', v_linhas, 'criados', v_criados, 'casados', v_casados);
end; $$;

revoke execute on function rh_importar_folha(uuid,date,jsonb,boolean) from public;
grant execute on function rh_importar_folha(uuid,date,jsonb,boolean) to authenticated;

-- ── rh_folha_plano: sócio = escolha gravada; heurística da categoria só como fallback ──
create or replace function rh_folha_plano(p_org_id uuid, p_competencia date)
returns jsonb language plpgsql stable security definer set search_path to 'public' as $$
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
  if not rh_can(p_org_id) then raise exception 'Acesso negado' using errcode = '42501'; end if;

  for r in
    select f.colaborador_id, coalesce(c.nome, f.nome) as nome, f.liquido,
      coalesce(f.tratamento,
        case when rh_vinculo_da_categoria(f.categoria) = 'pj' then 'socio' else 'salario' end) as trat
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
end; $$;
revoke execute on function rh_folha_plano(uuid, date) from public;
grant execute on function rh_folha_plano(uuid, date) to authenticated;

notify pgrst, 'reload schema';
