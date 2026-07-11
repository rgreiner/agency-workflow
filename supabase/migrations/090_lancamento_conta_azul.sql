-- 090_lancamento_conta_azul.sql
-- "Promover ao editar": transforma uma linha do extrato importado (Conta Azul) num
-- lançamento editável do Flow. origem_tipo='conta_azul' e origem_ref = import_ref
-- (chave ESTÁVEL do extrato). A tela Lançamentos usa origem_ref p/ esconder a linha
-- importada correspondente — assim, mesmo reimportando o extrato completo, não duplica
-- (o lançamento promovido "assume" a transação). Idempotente.

alter table lancamentos add column if not exists origem_ref text;
create index if not exists idx_lancamentos_origem_ref on lancamentos(org_id, origem_ref);

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

  insert into lancamentos (
    org_id, origem_tipo, origem_ref, tipo, contato_nome, descricao, valor,
    vencimento, competencia, situacao, conta_id, categoria, centro_custo,
    forma_pagamento, observacao, data_liquidacao, valor_realizado,
    juros, multa, desconto, tarifa, created_by
  ) values (
    p_org_id, 'conta_azul', p_import_ref,
    coalesce(nullif(p_dados->>'tipo',''), 'entrada'),
    nullif(p_dados->>'contato_nome',''),
    nullif(p_dados->>'descricao',''),
    coalesce(nullif(p_dados->>'valor','')::numeric, 0),
    nullif(p_dados->>'vencimento','')::date,
    coalesce(nullif(p_dados->>'competencia','')::date, nullif(p_dados->>'vencimento','')::date),
    coalesce(nullif(p_dados->>'situacao',''), 'em_aberto'),
    nullif(p_dados->>'conta_id','')::uuid,
    nullif(p_dados->>'categoria',''),
    nullif(p_dados->>'centro_custo',''),
    nullif(p_dados->>'forma_pagamento',''),
    nullif(p_dados->>'observacao',''),
    nullif(p_dados->>'data_liquidacao','')::date,
    nullif(p_dados->>'valor_realizado','')::numeric,
    coalesce(nullif(p_dados->>'juros','')::numeric, 0),
    coalesce(nullif(p_dados->>'multa','')::numeric, 0),
    coalesce(nullif(p_dados->>'desconto','')::numeric, 0),
    coalesce(nullif(p_dados->>'tarifa','')::numeric, 0),
    p_user_id
  ) returning id into v_id;
  return v_id;
end; $$;

grant execute on function promover_extrato(uuid,uuid,text,jsonb) to anon, authenticated;

notify pgrst, 'reload schema';
