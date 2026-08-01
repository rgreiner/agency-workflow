-- 176_vinculo_socio.sql
-- Sócio vira vínculo de verdade na ficha (Lidia/Rafael estavam como "CLT"):
--   • rh_vinculo_da_categoria: categoria 722/contribuinte individual → 'socio'
--     (antes 'pj' — sócio não é terceirizado; o bootstrap da folha passa a gravar certo).
--   • rh_folha_plano: heurística acompanha ('socio' no lugar de 'pj').
--   • Backfill: ficha de quem aparece na folha como 722 vira tipo_vinculo='socio'.
-- Idempotente.

create or replace function rh_vinculo_da_categoria(p_cat text)
returns text language sql immutable as $$
  select case when p_cat ilike '%722%' or p_cat ilike '%individual%' then 'socio' else 'clt' end;
$$;

update rh_colaborador c set tipo_vinculo = 'socio', updated_at = now()
where exists (select 1 from rh_folha f
              where f.colaborador_id = c.id
                and (f.categoria ilike '%722%' or f.categoria ilike '%individual%'))
  and coalesce(c.tipo_vinculo, '') <> 'socio';

-- ── rh_folha_plano (mesmo corpo da 174; só a heurística do sócio acompanha) ──
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
end; $$;
revoke execute on function rh_folha_plano(uuid, date) from public;
grant execute on function rh_folha_plano(uuid, date) to authenticated;

notify pgrst, 'reload schema';
