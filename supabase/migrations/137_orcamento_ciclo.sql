-- 137: orçamento fecha o ciclo ao gerar as PPs, e o vínculo PP→orçamento vira coluna.
--
-- Dois problemas que andavam juntos:
--
-- 1) "Gerar PPs" não era idempotente. Como gerar não mudava a situação do orçamento,
--    o botão continuava lá pra sempre — dois cliques = dois conjuntos de PPs
--    duplicados, sem aviso nenhum.
--
-- 2) O vínculo do PP com o orçamento de origem era gravado só dentro do jsonb
--    `detalhe.orcamento_id`, sem coluna, sem FK e sem ninguém lendo. E como o
--    PedidoForm reescreve `detalhe` inteiro ao salvar, abrir o PP e clicar em Gravar
--    apagava a origem pra sempre.
--
-- Agora: coluna de verdade + situação 'concluido' (fim de ciclo do orçamento; o
-- trabalho virou produção). 'concluido' entra na lista de situações que saem da aba
-- Ativos, junto de faturado/cancelado.

alter table producao add column if not exists origem_orcamento_id uuid
  references producao(id) on delete set null;
create index if not exists idx_producao_origem_orcamento on producao(origem_orcamento_id);
comment on column producao.origem_orcamento_id is
  'Orçamento (producao.tipo=orcamento) que gerou este PP. Antes vivia só em detalhe->orcamento_id.';

-- Backfill do que já foi gerado: resgata o vínculo dos PPs cujo detalhe ainda o tem.
update producao p set origem_orcamento_id = (p.detalhe->>'orcamento_id')::uuid
 where p.origem_orcamento_id is null
   and p.detalhe->>'orcamento_id' is not null
   and exists (select 1 from producao o where o.id = (p.detalhe->>'orcamento_id')::uuid);

-- create_producao passa a aceitar origem_orcamento_id (mesma assinatura — o PostgREST
-- só tolera 1 overload por RPC).
create or replace function create_producao(p_user_id uuid, p_org_id uuid, p_data jsonb)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_id uuid; v_numero integer; v_tipo text; v_serie text;
begin
  if not exists (select 1 from organization_members where org_id=p_org_id and user_id=p_user_id and role in ('owner','admin','manager'))
  then raise exception 'Acesso negado'; end if;
  v_tipo := coalesce(nullif(p_data->>'tipo',''), 'orcamento');
  v_serie := serie_de_producao(v_tipo);

  if v_serie is not null then
    v_numero := next_doc_numero(p_org_id, v_serie);         -- PP / FEE / PR: contador da série
  else
    select coalesce(max(numero),0)+1 into v_numero          -- orçamento: numeração interna
      from producao where org_id=p_org_id and tipo=v_tipo;
  end if;

  insert into producao (org_id, numero, serie, tipo, workspace_id, campaign_id, titulo, faturar, emissao, validade_dias,
    bv_pct, honorarios_pct, valor, codigo_identificador, nota_fiscal, situacao, observacao, texto_legal, contato, responsavel_id,
    detalhe, origem_orcamento_id, created_by)
  values (p_org_id, v_numero, v_serie, v_tipo, (p_data->>'workspace_id')::uuid, nullif(p_data->>'campaign_id','')::uuid,
    coalesce(nullif(p_data->>'titulo',''),'(sem título)'), nullif(p_data->>'faturar',''), nullif(p_data->>'emissao','')::date,
    nullif(p_data->>'validade_dias','')::int, coalesce(nullif(p_data->>'bv_pct','')::numeric,15), coalesce(nullif(p_data->>'honorarios_pct','')::numeric,0),
    coalesce(nullif(p_data->>'valor','')::numeric,0), nullif(p_data->>'codigo_identificador',''), nullif(p_data->>'nota_fiscal',''),
    coalesce(nullif(p_data->>'situacao',''),'em_aberto'), nullif(p_data->>'observacao',''), nullif(p_data->>'texto_legal',''),
    nullif(p_data->>'contato',''), nullif(p_data->>'responsavel_id','')::uuid, coalesce(p_data->'detalhe','{}'::jsonb),
    nullif(p_data->>'origem_orcamento_id','')::uuid, p_user_id)
  returning id into v_id;
  return v_id;
end; $$;

grant execute on function create_producao(uuid,uuid,jsonb) to anon, authenticated;

-- ── Concluir o orçamento (fim de ciclo) ──
-- A geração das PPs continua em TypeScript de propósito: ela depende de parse de
-- dinheiro em formato BR ("1.234,56"), de `quant` que vem da OPÇÃO e não do item, e
-- do campo n_orc. Reescrever isso em PL/pgSQL trocaria um bug por outro. Aqui fica só
-- o fechamento do ciclo, que é a parte que o banco precisa garantir.
create or replace function concluir_orcamento(p_user_id uuid, p_orcamento_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare o record;
begin
  select * into o from producao where id = p_orcamento_id;
  if not found then raise exception 'Orçamento não encontrado'; end if;
  if o.tipo <> 'orcamento' then raise exception 'Este documento não é um orçamento'; end if;
  if not exists (
    select 1 from organization_members
    where org_id = o.org_id and user_id = p_user_id and role in ('owner','admin','manager')
  ) then raise exception 'Acesso negado'; end if;

  update producao set situacao = 'concluido', updated_at = now() where id = p_orcamento_id;
end; $$;

grant execute on function concluir_orcamento(uuid,uuid) to anon, authenticated;

notify pgrst, 'reload schema';
