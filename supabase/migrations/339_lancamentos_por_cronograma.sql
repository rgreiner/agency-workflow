-- Cronograma de parcelas vira uma série de lançamentos, com o valor de CADA uma.
--
-- O Rafael subiu na tela "Lançar despesa" a previsão de parcelas do empréstimo
-- da Cresol: 55 parcelas, 15/07/2026 a 15/03/2031, valores DECRESCENTES
-- (8.899,46 → 2.873,20). A tela leu um cabeçalho e ignorou a tabela. E nenhuma
-- parcela desse empréstimo estava lançada (medido em 09/10/2026) — nem a de
-- 15/10, R$ 7.620,74, que o OFX da Cresol já tinha mostrado agendada.
--
-- create_lancamentos_serie não serve: ela divide um total em partes IGUAIS (ou
-- repete o mesmo valor). Num empréstimo amortizado cada parcela tem o seu
-- valor. Esta função grava a lista que vier, numa transação só — 55 chamadas
-- soltas a create_lancamento poderiam parar no meio e deixar meia série.
--
-- Segue a convenção da série existente: um grupo_id para todas, parcela_num e
-- parcela_total, descrição "X (n/N)", em aberto. O NÚMERO é o do documento: se a
-- parcela 1 já foi paga e não entra, as outras continuam sendo 2/55, 3/55…

create or replace function public.create_lancamentos_cronograma(
  p_user_id uuid, p_org_id uuid, p_data jsonb, p_parcelas jsonb
) returns int
language plpgsql security definer set search_path = public as $$
declare
  v_grupo uuid := uuid_generate_v4();
  v_desc text := nullif(btrim(p_data->>'descricao'), '');
  v_total int := nullif(p_data->>'parcela_total', '')::int;
  v_tipo_contato text := nullif(p_data->>'contato_tipo', '');
  v_contato_id uuid := nullif(p_data->>'contato_id', '')::uuid;
  r record;
  v_n int := 0;
begin
  if p_user_id is distinct from auth.uid() then
    raise exception 'Acesso negado' using errcode = '42501';
  end if;
  if not exists (
    select 1 from organization_members
     where org_id = p_org_id and user_id = p_user_id and role in ('owner','admin','manager')
  ) then raise exception 'Acesso negado'; end if;

  if jsonb_typeof(p_parcelas) is distinct from 'array' or jsonb_array_length(p_parcelas) = 0 then
    raise exception 'Nenhuma parcela informada.';
  end if;
  if jsonb_array_length(p_parcelas) > 240 then
    raise exception 'Cronograma grande demais (% parcelas).', jsonb_array_length(p_parcelas);
  end if;

  -- Mesma regra da create_lancamento: o vínculo só vale para cadastro da org.
  if v_contato_id is not null and not (
       (v_tipo_contato = 'fornecedor' and exists (select 1 from fornecedores where id = v_contato_id and org_id = p_org_id))
    or (v_tipo_contato = 'veiculo'    and exists (select 1 from veiculos     where id = v_contato_id and org_id = p_org_id))
    or (v_tipo_contato = 'cliente'    and exists (select 1 from workspaces   where id = v_contato_id and org_id = p_org_id))
  ) then
    v_contato_id := null;
  end if;

  for r in select * from jsonb_to_recordset(p_parcelas) as x(numero int, vencimento date, valor numeric) loop
    if r.vencimento is null or coalesce(r.valor, 0) <= 0 then
      raise exception 'Parcela % sem data ou valor.', coalesce(r.numero::text, '?');
    end if;

    insert into lancamentos (
      org_id, tipo, origem_tipo, contato_tipo, contato_id, contato_nome, descricao, valor,
      vencimento, competencia, situacao, conta_id, categoria, centro_custo,
      forma_pagamento, observacao, anexos, recorrente, parcela_num, parcela_total, grupo_id, created_by
    ) values (
      p_org_id,
      coalesce(nullif(p_data->>'tipo',''), 'saida'),
      'manual',
      v_tipo_contato,
      v_contato_id,
      nullif(p_data->>'contato_nome',''),
      case when r.numero is not null and v_total is not null
           then trim(coalesce(v_desc, '')) || ' (' || r.numero || '/' || v_total || ')'
           else v_desc end,
      round(r.valor, 2),
      r.vencimento,
      r.vencimento,
      'em_aberto',
      nullif(p_data->>'conta_id','')::uuid,
      nullif(p_data->>'categoria',''),
      nullif(p_data->>'centro_custo',''),
      nullif(p_data->>'forma_pagamento',''),
      nullif(p_data->>'observacao',''),
      -- O cronograma fica anexado a TODAS: é o documento que justifica cada uma.
      coalesce(p_data->'anexos', '[]'::jsonb),
      false,
      r.numero,
      v_total,
      v_grupo,
      p_user_id
    );
    v_n := v_n + 1;
  end loop;

  return v_n;
end $$;

-- DEFAULT PRIVILEGES deste banco dá EXECUTE a anon/authenticated em toda função
-- nova; revogar de PUBLIC não toca nesses dois.
revoke execute on function public.create_lancamentos_cronograma(uuid, uuid, jsonb, jsonb) from public, anon;
grant execute on function public.create_lancamentos_cronograma(uuid, uuid, jsonb, jsonb) to authenticated;

notify pgrst, 'reload schema';
