-- 130_promover_extrato_anexos.sql
-- promover_extrato virou UPSERT na 125, mas o ramo de UPDATE esqueceu de gravar
-- `anexos` — só o INSERT gravava. Como o bulk "Trazer a receber/a pagar" já
-- promoveu 523 linhas, TODA edição de linha "Conta Azul → Flow" caía no UPDATE:
-- o PDF subia pro volume, o modal fechava sem erro e o anexo era descartado em
-- silêncio. Nenhum dos 523 lançamentos do conta_azul tinha anexo.
--
-- Aqui o UPDATE passa a gravar anexos, fazendo MERGE com o que já existe (e não
-- replace): a tela do item importado abre com a lista vazia, então um replace
-- apagaria anexo anexado antes por outro caminho. Idempotente.

create or replace function promover_extrato(p_user_id uuid, p_org_id uuid, p_import_ref text, p_dados jsonb)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_id uuid;
begin
  if not exists (
    select 1 from organization_members
    where org_id = p_org_id and user_id = p_user_id
      and (can_finance or role in ('owner','admin'))
  ) then raise exception 'Acesso negado'; end if;
  if coalesce(p_import_ref, '') = '' then raise exception 'import_ref vazio'; end if;

  select id into v_id from lancamentos
   where org_id = p_org_id and origem_ref = p_import_ref
   order by created_at desc limit 1;

  if v_id is not null then
    -- já promovido → atualiza (não duplica)
    update lancamentos set
      tipo            = coalesce(nullif(p_dados->>'tipo',''), tipo),
      contato_nome    = case when p_dados ? 'contato_nome' then nullif(p_dados->>'contato_nome','') else contato_nome end,
      descricao       = case when p_dados ? 'descricao' then nullif(p_dados->>'descricao','') else descricao end,
      valor           = coalesce(nullif(p_dados->>'valor','')::numeric, valor),
      vencimento      = case when p_dados ? 'vencimento' then nullif(p_dados->>'vencimento','')::date else vencimento end,
      competencia     = case when p_dados ? 'competencia' then nullif(p_dados->>'competencia','')::date else competencia end,
      situacao        = coalesce(nullif(p_dados->>'situacao',''), situacao),
      conta_id        = case when p_dados ? 'conta_id' then nullif(p_dados->>'conta_id','')::uuid else conta_id end,
      categoria       = case when p_dados ? 'categoria' then nullif(p_dados->>'categoria','') else categoria end,
      centro_custo    = case when p_dados ? 'centro_custo' then nullif(p_dados->>'centro_custo','') else centro_custo end,
      forma_pagamento = case when p_dados ? 'forma_pagamento' then nullif(p_dados->>'forma_pagamento','') else forma_pagamento end,
      observacao      = case when p_dados ? 'observacao' then nullif(p_dados->>'observacao','') else observacao end,
      -- ↓ o que faltava: merge dos anexos, sem perder o que já estava lá
      anexos          = case
                          when p_dados ? 'anexos' and jsonb_array_length(coalesce(p_dados->'anexos','[]'::jsonb)) > 0
                          then (select coalesce(jsonb_agg(distinct x), '[]'::jsonb)
                                  from jsonb_array_elements(
                                         coalesce(lancamentos.anexos, '[]'::jsonb)
                                         || coalesce(p_dados->'anexos', '[]'::jsonb)) x)
                          else lancamentos.anexos
                        end,
      updated_at      = now()
    where id = v_id;
    return v_id;
  end if;

  insert into lancamentos (
    org_id, origem_tipo, origem_ref, tipo, contato_nome, descricao, valor,
    vencimento, competencia, situacao, conta_id, categoria, centro_custo,
    forma_pagamento, observacao, data_liquidacao, valor_realizado,
    juros, multa, desconto, tarifa, anexos, created_by
  ) values (
    p_org_id, 'conta_azul', p_import_ref,
    coalesce(nullif(p_dados->>'tipo',''), 'entrada'),
    nullif(p_dados->>'contato_nome',''), nullif(p_dados->>'descricao',''),
    coalesce(nullif(p_dados->>'valor','')::numeric, 0),
    nullif(p_dados->>'vencimento','')::date,
    coalesce(nullif(p_dados->>'competencia','')::date, nullif(p_dados->>'vencimento','')::date),
    coalesce(nullif(p_dados->>'situacao',''), 'em_aberto'),
    nullif(p_dados->>'conta_id','')::uuid,
    nullif(p_dados->>'categoria',''), nullif(p_dados->>'centro_custo',''),
    nullif(p_dados->>'forma_pagamento',''), nullif(p_dados->>'observacao',''),
    nullif(p_dados->>'data_liquidacao','')::date, nullif(p_dados->>'valor_realizado','')::numeric,
    coalesce(nullif(p_dados->>'juros','')::numeric, 0),
    coalesce(nullif(p_dados->>'multa','')::numeric, 0),
    coalesce(nullif(p_dados->>'desconto','')::numeric, 0),
    coalesce(nullif(p_dados->>'tarifa','')::numeric, 0),
    coalesce(p_dados->'anexos', '[]'::jsonb), p_user_id
  ) returning id into v_id;
  return v_id;
end; $$;

grant execute on function promover_extrato(uuid, uuid, text, jsonb) to anon, authenticated;

notify pgrst, 'reload schema';
