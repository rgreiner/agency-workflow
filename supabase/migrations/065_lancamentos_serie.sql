-- 065_lancamentos_serie.sql
-- Cria uma série de lançamentos manuais ligados por grupo_id:
--   modo 'parcelado'  → divide o valor total em N parcelas mensais (i/N).
--   modo 'recorrente' → repete o valor cheio por N meses (recorrente = true).
-- Vencimento/competência avançam 1 mês a cada ocorrência. Idempotente (replace).

create or replace function create_lancamentos_serie(p_user_id uuid, p_org_id uuid, p_data jsonb, p_modo text, p_n int)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_grupo uuid := uuid_generate_v4();
  v_total numeric(14,2) := coalesce(nullif(p_data->>'valor','')::numeric, 0);
  v_venc date := nullif(p_data->>'vencimento','')::date;
  v_comp date := coalesce(nullif(p_data->>'competencia','')::date, nullif(p_data->>'vencimento','')::date);
  v_n int := greatest(coalesce(p_n, 1), 1);
  v_parc numeric(14,2) := 0;
  v_acc numeric(14,2) := 0;
  v_val numeric(14,2);
  v_desc text := nullif(p_data->>'descricao','');
  i int;
begin
  if not exists (
    select 1 from organization_members
    where org_id = p_org_id and user_id = p_user_id and role in ('owner','admin','manager')
  ) then raise exception 'Acesso negado'; end if;

  if p_modo = 'parcelado' then v_parc := round(v_total / v_n, 2); end if;

  for i in 1..v_n loop
    if p_modo = 'parcelado' then
      if i < v_n then v_val := v_parc; v_acc := v_acc + v_parc;
      else v_val := round(v_total - v_acc, 2); end if;   -- última parcela leva o resto
    else
      v_val := v_total;                                  -- recorrente: valor cheio por mês
    end if;

    insert into lancamentos (
      org_id, tipo, origem_tipo, contato_tipo, contato_nome, descricao, valor,
      vencimento, competencia, situacao, conta_id, categoria, centro_custo,
      forma_pagamento, observacao, recorrente, parcela_num, parcela_total, grupo_id, created_by
    ) values (
      p_org_id,
      coalesce(nullif(p_data->>'tipo',''), 'saida'),
      'manual',
      nullif(p_data->>'contato_tipo',''),
      nullif(p_data->>'contato_nome',''),
      case when p_modo = 'parcelado' then trim(coalesce(v_desc, '')) || ' (' || i || '/' || v_n || ')' else v_desc end,
      v_val,
      case when v_venc is not null then (v_venc + ((i - 1) * interval '1 month'))::date else null end,
      case when v_comp is not null then (v_comp + ((i - 1) * interval '1 month'))::date else null end,
      'em_aberto',
      nullif(p_data->>'conta_id','')::uuid,
      nullif(p_data->>'categoria',''),
      nullif(p_data->>'centro_custo',''),
      nullif(p_data->>'forma_pagamento',''),
      nullif(p_data->>'observacao',''),
      (p_modo = 'recorrente'),
      case when p_modo = 'parcelado' then i else null end,
      case when p_modo = 'parcelado' then v_n else null end,
      v_grupo,
      p_user_id
    );
  end loop;
end; $$;

grant execute on function create_lancamentos_serie(uuid,uuid,jsonb,text,int) to anon, authenticated;

notify pgrst, 'reload schema';
