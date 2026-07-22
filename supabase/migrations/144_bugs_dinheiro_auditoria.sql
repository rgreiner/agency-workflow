-- 144_bugs_dinheiro_auditoria.sql
-- Bugs de dinheiro da auditoria 22/07/2026 (decisões do Rafael). Idempotente.
-- Parte das defs VIVAS pós-143 (mantém o guard `p_user_id = auth.uid()`).
--
--  Bug 2  transferência: read-only + não-reabrível (excluir usa excluir_transferencia,
--         que já bloqueia se conciliado — a UI roteia pra lá).
--  Bug 3  não faturar com valor ZERO (fee E pedido).
--  Bug 4  regenerar produção não destrói baixa PARCIAL nem anexos/categoria.
--  Bug 6  saldo_banco e cobranca_auto passam a gravar por RPC (permissão certa).

-- ── Bug 2: transferência não se edita (evita desalinhar os 2 lados) ──
create or replace function public.update_lancamento(p_user_id uuid, p_lancamento_id uuid, p_data jsonb)
 returns void language plpgsql security definer set search_path to 'public'
as $function$
declare l record; v_livre boolean;
begin
  if p_user_id is distinct from auth.uid() then
    raise exception 'Acesso negado' using errcode = '42501';
  end if;
  select * into l from lancamentos where id = p_lancamento_id;
  if not found then raise exception 'Lançamento não encontrado'; end if;
  if not exists (
    select 1 from organization_members
    where org_id = l.org_id and user_id = p_user_id and role in ('owner','admin','manager')
  ) then raise exception 'Acesso negado'; end if;

  -- Transferência entre contas é gerada em par (saída+entrada ligadas por transferencia_id).
  -- Editar um lado (conta/categoria/data) desalinha o saldo consolidado; a via correta é
  -- excluir (excluir_transferencia apaga os 2) e refazer.
  if l.transferencia_id is not null then
    raise exception 'Transferência entre contas não pode ser editada. Exclua e refaça.';
  end if;

  -- Texto/valor são livres quando NÃO existe documento vivo por trás. Em produção/mídia
  -- o documento é a fonte — editar aqui seria desfeito na próxima regeração.
  v_livre := l.origem_tipo in ('manual', 'conta_azul', 'ofx');

  update lancamentos set
    tipo            = case when v_livre then coalesce(nullif(p_data->>'tipo',''), tipo) else tipo end,
    contato_tipo    = case when v_livre and p_data ? 'contato_tipo' then nullif(p_data->>'contato_tipo','') else contato_tipo end,
    contato_nome    = case when v_livre and p_data ? 'contato_nome' then nullif(p_data->>'contato_nome','') else contato_nome end,
    descricao       = case when v_livre and p_data ? 'descricao' then nullif(p_data->>'descricao','') else descricao end,
    valor           = case when v_livre then coalesce(nullif(p_data->>'valor','')::numeric, valor) else valor end,
    vencimento      = case when p_data ? 'vencimento' then nullif(p_data->>'vencimento','')::date else vencimento end,
    competencia     = case when p_data ? 'competencia' then nullif(p_data->>'competencia','')::date else competencia end,
    conta_id        = case when p_data ? 'conta_id' then nullif(p_data->>'conta_id','')::uuid else conta_id end,
    categoria       = case when p_data ? 'categoria' then nullif(p_data->>'categoria','') else categoria end,
    centro_custo    = case when p_data ? 'centro_custo' then nullif(p_data->>'centro_custo','') else centro_custo end,
    forma_pagamento = case when p_data ? 'forma_pagamento' then nullif(p_data->>'forma_pagamento','') else forma_pagamento end,
    observacao      = case when p_data ? 'observacao' then nullif(p_data->>'observacao','') else observacao end,
    recorrente      = coalesce((p_data->>'recorrente')::boolean, recorrente),
    updated_at      = now()
  where id = p_lancamento_id;
end; $function$;

-- ── Bug 2: transferência não tem baixa a reabrir ──
create or replace function public.reabrir_lancamento(p_user_id uuid, p_lancamento_id uuid)
 returns void language plpgsql security definer set search_path to 'public'
as $function$
declare l record;
begin
  if p_user_id is distinct from auth.uid() then
    raise exception 'Acesso negado' using errcode = '42501';
  end if;
  select * into l from lancamentos where id = p_lancamento_id;
  if not found then return; end if;
  if not exists (
    select 1 from organization_members
    where org_id = l.org_id and user_id = p_user_id and role in ('owner','admin','manager')
  ) then raise exception 'Acesso negado'; end if;
  if l.transferencia_id is not null then
    raise exception 'Transferência não tem baixa a reabrir. Exclua e refaça.';
  end if;
  update lancamentos set
    situacao = 'em_aberto', data_liquidacao = null, valor_realizado = null,
    juros = 0, multa = 0, desconto = 0, tarifa = 0, updated_at = now()
  where id = p_lancamento_id;
end; $function$;

-- ── Bug 3: não faturar documento com valor a receber ZERO (fee E pedido) ──
create or replace function public.set_producao_situacao(p_user_id uuid, p_producao_id uuid, p_situacao text, p_conta_id uuid default null, p_categoria text default null, p_centro_custo text default null, p_forma text default null)
 returns void language plpgsql security definer set search_path to 'public'
as $function$
declare v_receber numeric;
begin
  if p_user_id is distinct from auth.uid() then
    raise exception 'Acesso negado' using errcode = '42501';
  end if;
  if not exists (
    select 1 from producao p join organization_members om on om.org_id = p.org_id
    where p.id = p_producao_id and om.user_id = p_user_id and om.role in ('owner','admin','manager')
  ) then raise exception 'Acesso negado'; end if;

  -- Ao faturar/aprovar, tem que haver valor a receber. Soma as parcelas com tipo a
  -- receber; se der zero (parcelas sem tipo, sem valor, ou nenhuma), barra — senão o
  -- documento vira 'faturado' sem gerar lançamento e o dinheiro some do caixa.
  if p_situacao in ('faturar','faturado') then
    select coalesce(sum(coalesce(nullif(e.parc->>'valor','')::numeric, 0)), 0)
      into v_receber
      from producao pr, jsonb_array_elements(coalesce(pr.detalhe->'parcelas','[]'::jsonb)) as e(parc)
      where pr.id = p_producao_id
        and e.parc->>'tipo' in ('receber_bv','receber_honorarios','receber_cliente');
    if coalesce(v_receber, 0) <= 0 then
      raise exception 'Não há valor a faturar neste documento. Configure as parcelas a receber (com tipo e valor) antes de faturar.';
    end if;
  end if;

  update producao set situacao = p_situacao, updated_at = now() where id = p_producao_id;
  perform gerar_lancamentos_producao(p_producao_id, p_conta_id, p_categoria, p_centro_custo, p_forma);
end; $function$;

-- ── Bug 4: regenerar não destrói baixa parcial, anexos por parcela nem categoria ──
create or replace function public.gerar_lancamentos_producao(p_producao_id uuid, p_conta_id uuid default null, p_categoria text default null, p_centro_custo text default null, p_forma text default null)
 returns void language plpgsql security definer set search_path to 'public'
as $function$
declare
  p record; forn_nome text;
  v_ex_conta uuid; v_ex_centro text; v_ex_forma text; v_ex_categoria text;
  v_conta uuid; v_centro text; v_forma text; v_anexos jsonb;
begin
  select pr.*, w.name as cliente_nome into p
    from producao pr join workspaces w on w.id = pr.workspace_id
    where pr.id = p_producao_id;
  if not found then return; end if;
  if p.tipo not in ('pedido', 'fee', 'proposta') then return; end if;

  -- NÃO regenerar (não destruir) se qualquer parcela já tem baixa: total (recebido/pago)
  -- OU PARCIAL (valor_realizado > 0). A parcial estava desprotegida — o delete apagava a
  -- baixa e, por cascade, a conciliação bancária.
  if exists (
    select 1 from lancamentos
    where origem_tipo = 'producao' and origem_id = p_producao_id
      and (situacao in ('recebido','pago') or coalesce(valor_realizado, 0) > 0)
  ) then return; end if;

  -- Preserva a classificação já gravada (conta/centro/forma/categoria). Só a tela de
  -- Faturamento a define; uma mudança de status na tela de Produção chama sem os params
  -- e, sem isto, zeraria a classificação de volta ao default.
  select conta_id, centro_custo, forma_pagamento
    into v_ex_conta, v_ex_centro, v_ex_forma
    from lancamentos where origem_tipo = 'producao' and origem_id = p_producao_id
    order by parcela_num nulls first limit 1;
  -- categoria: de uma parcela NÃO-comissão (a que o usuário classifica; a comissão é sempre 'Comissão').
  select categoria into v_ex_categoria
    from lancamentos where origem_tipo = 'producao' and origem_id = p_producao_id
      and categoria is distinct from 'Comissão'
    order by parcela_num nulls first limit 1;
  -- anexos por parcela (NF/boleto anexados nas parcelas 2..N não somem na regen).
  select jsonb_object_agg(coalesce(parcela_num, 1)::text, anexos) into v_anexos
    from lancamentos where origem_tipo = 'producao' and origem_id = p_producao_id
      and anexos is not null and anexos <> '[]'::jsonb;

  v_conta  := coalesce(p_conta_id, v_ex_conta);
  v_centro := coalesce(p_centro_custo, v_ex_centro, p.cliente_nome);
  v_forma  := coalesce(p_forma, v_ex_forma);

  delete from lancamentos where origem_tipo = 'producao' and origem_id = p_producao_id;

  if p.situacao <> 'faturado' then return; end if;

  select name into forn_nome from fornecedores where id = nullif(p.detalhe->>'fornecedor_id','')::uuid;

  insert into lancamentos (
    org_id, tipo, origem_tipo, origem_id, contato_tipo, contato_nome,
    descricao, valor, vencimento, competencia, situacao, anexos,
    parcela_num, parcela_total, conta_id, categoria, centro_custo, forma_pagamento, created_by
  )
  select
    p.org_id, 'entrada', 'producao', p_producao_id, x.ct, x.cn, x.descr,
    x.valor, x.venc, x.venc, 'em_aberto',
    -- anexos: reusa os que existiam naquela parcela; senão, doc na 1ª parcela.
    coalesce(
      v_anexos -> coalesce((case when x.total > 1 then x.rn::int end), 1)::text,
      case when x.rn = 1 then coalesce(p.anexos, '[]'::jsonb) else '[]'::jsonb end
    ),
    case when x.total > 1 then x.rn::int end,
    case when x.total > 1 then x.total::int end,
    v_conta,
    case x.ptipo
      when 'receber_bv'         then 'Comissão'
      when 'receber_honorarios' then coalesce(p_categoria, v_ex_categoria, 'Receitas de Serviços')
      else coalesce(p_categoria, v_ex_categoria, case p.tipo when 'fee' then 'Fee' when 'pedido' then 'Job' else 'Produção' end)
    end,
    v_centro, v_forma, p.created_by
  from (
    select b.*,
           row_number() over (partition by b.descr order by b.venc nulls last, b.ord) as rn,
           count(*)     over (partition by b.descr)                                   as total
      from (
        select
          e.parc->>'tipo' as ptipo,
          case e.parc->>'tipo' when 'receber_bv' then 'fornecedor' else 'cliente' end as ct,
          case e.parc->>'tipo' when 'receber_bv' then coalesce(forn_nome, 'Fornecedor') else p.cliente_nome end as cn,
          case e.parc->>'tipo'
            when 'receber_bv'          then 'Comissão'
            when 'receber_honorarios'  then 'Honorários'
            else coalesce(nullif(p.titulo,''), case when p.tipo = 'fee' then 'Fee' else 'Proposta' end)
          end as descr,
          coalesce(nullif(e.parc->>'valor','')::numeric, 0) as valor,
          nullif(e.parc->>'vencimento','')::date            as venc,
          e.ord
        from jsonb_array_elements(coalesce(p.detalhe->'parcelas', '[]'::jsonb))
             with ordinality as e(parc, ord)
        where e.parc->>'tipo' in ('receber_bv','receber_honorarios','receber_cliente')
      ) b
  ) x;
end; $function$;

-- ── Bug 6a: cobranca_auto grava pela RPC de cadastro (a policy da tabela é manager+; a
--    RPC aceita can_vendas — o update direto falhava em silêncio pra esse perfil) ──
create or replace function public.update_workspace_cadastro(p_user_id uuid, p_workspace_id uuid, p_data jsonb)
 returns void language plpgsql security definer set search_path to 'public'
as $function$
begin
  if p_user_id is distinct from auth.uid() then
    raise exception 'Acesso negado' using errcode = '42501';
  end if;
  if not exists (
    select 1 from workspaces w join organization_members om on om.org_id = w.org_id
    where w.id = p_workspace_id and om.user_id = p_user_id
      and (om.role in ('owner','admin','manager') or om.can_finance or om.can_vendas)
  ) then raise exception 'Acesso negado'; end if;

  update workspaces set
    name               = coalesce(nullif(p_data->>'name',''), name),
    description        = nullif(p_data->>'description',''),
    color              = coalesce(nullif(p_data->>'color',''), color),
    legal_name         = nullif(p_data->>'legal_name',''),
    trade_name         = nullif(p_data->>'trade_name',''),
    tax_id             = nullif(p_data->>'tax_id',''),
    state_registration = nullif(p_data->>'state_registration',''),
    city_registration  = nullif(p_data->>'city_registration',''),
    finance_email      = nullif(p_data->>'finance_email',''),
    phone              = nullif(p_data->>'phone',''),
    contact_name       = nullif(p_data->>'contact_name',''),
    address_zip        = nullif(p_data->>'address_zip',''),
    address_street     = nullif(p_data->>'address_street',''),
    address_number     = nullif(p_data->>'address_number',''),
    address_complement = nullif(p_data->>'address_complement',''),
    address_district   = nullif(p_data->>'address_district',''),
    address_city       = nullif(p_data->>'address_city',''),
    address_state      = nullif(p_data->>'address_state',''),
    payment_terms      = nullif(p_data->>'payment_terms',''),
    atividade          = nullif(p_data->>'atividade',''),
    -- cobranca_auto agora pela RPC (só aplica se veio no payload)
    cobranca_auto      = case when p_data ? 'cobranca_auto' then (p_data->>'cobranca_auto')::boolean else cobranca_auto end,
    enderecos          = coalesce(p_data->'enderecos', enderecos),
    telefones          = coalesce(p_data->'telefones', telefones),
    emails             = coalesce(p_data->'emails', emails),
    contas_bancarias   = coalesce(p_data->'contas_bancarias', contas_bancarias),
    updated_at         = now()
  where id = p_workspace_id;
end; $function$;

-- ── Bug 6b: saldo do banco grava por RPC (a tela é can_finance; a policy da tabela é
--    manager+ — o update direto sumia em silêncio pra quem é só can_finance) ──
create or replace function public.set_conta_saldo_banco(p_user_id uuid, p_conta_id uuid, p_saldo numeric, p_data date)
 returns void language plpgsql security definer set search_path to 'public'
as $function$
begin
  if p_user_id is distinct from auth.uid() then
    raise exception 'Acesso negado' using errcode = '42501';
  end if;
  if not exists (
    select 1 from contas_financeiras c join organization_members om on om.org_id = c.org_id
    where c.id = p_conta_id and om.user_id = p_user_id
      and (om.role in ('owner','admin','manager') or om.can_finance)
  ) then raise exception 'Acesso negado'; end if;
  update contas_financeiras set saldo_banco = p_saldo, saldo_banco_data = p_data where id = p_conta_id;
end; $function$;

revoke execute on function public.set_conta_saldo_banco(uuid,uuid,numeric,date) from public;
grant execute on function public.set_conta_saldo_banco(uuid,uuid,numeric,date) to authenticated;

notify pgrst, 'reload schema';
