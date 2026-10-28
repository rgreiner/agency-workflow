-- 386 — a Flávia confere e fatura a fila de Financeiro → Faturamento (28/10/2026)
--
-- Decisão do Rafael (28/10): duas vezes ao dia a Flávia passa a fila (mídia,
-- fee, pedido, proposta e venda em "A Faturar"), confere se nada falta e
-- FATURA SOZINHA. Faltando dado, o documento vira pendência com o motivo.
-- Faturar é o mesmo ato da tela: as mesmas funções geram os lançamentos.
--
--   fin_faturamento_fila(org)                 → a fila com o que falta em cada um
--   fin_faturar_agente(org, tipo, id)         → fatura (re-confere antes)
--   fin_anexar_documento_fila(org, tipo, id, anexo) → NF/boleto do veículo/fornecedor
--                                                que chega com o documento ainda na fila
--   fin_nfse_a_emitir(org)                    → comissões faturadas sem NFS-e da agência,
--                                                prontas = NF do veículo já veio OU o mês
--                                                do vencimento chegou (regra do Rafael)
--
-- Todas exigem fin_can + token de agente vivo (fin_agente_folha), como a folha.

-- Faltas do documento — a mesma conta para a fila e para a re-conferência do faturar.
create or replace function public._fat_faltas_midia(m midias)
returns text[]
language sql
stable
security definer
set search_path to 'public'
as $$
  select array_remove(array[
    case when m.veiculo_id is null then 'sem veículo' end,
    case when m.workspace_id is null then 'sem cliente' end,
    case when m.data_base is null then 'sem data base' end,
    case when coalesce(m.prazo, '') = '' then 'sem prazo de pagamento' end,
    case when coalesce(m.valor, 0) <= 0 then 'valor zerado' end,
    case when round(coalesce(m.valor, 0) * coalesce(m.desconto_pct, 0) / 100.0, 2)
              + round(round(_br_num(m.detalhe->>'producao_valor')
                  * greatest(coalesce(nullif(_br_num(m.detalhe->>'producao_quantidade'), 0), 1), 1), 2)
                  * _br_num(m.detalhe->>'producao_comissao_pct') / 100.0, 2) <= 0
         then 'comissão zerada — só o Rafael fatura sem comissão' end
  ], null);
$$;
revoke execute on function public._fat_faltas_midia(midias) from public, anon, authenticated;

create or replace function public._fat_faltas_producao(p producao)
returns text[]
language sql
stable
security definer
set search_path to 'public'
as $$
  select array_remove(array[
    case when p.workspace_id is null then 'sem cliente' end,
    case when coalesce((select sum(coalesce(nullif(e->>'valor', '')::numeric, 0))
                          from jsonb_array_elements(coalesce(p.detalhe->'parcelas', '[]'::jsonb)) e
                         where e->>'tipo' in ('receber_bv', 'receber_honorarios', 'receber_cliente')), 0) <= 0
         then 'sem parcela a receber com valor' end,
    case when exists (select 1 from jsonb_array_elements(coalesce(p.detalhe->'parcelas', '[]'::jsonb)) e
                       where e->>'tipo' in ('receber_bv', 'receber_honorarios', 'receber_cliente')
                         and coalesce(e->>'vencimento', '') = '')
         then 'parcela a receber sem vencimento' end,
    case when exists (select 1 from jsonb_array_elements(coalesce(p.detalhe->'parcelas', '[]'::jsonb)) e
                       where e->>'tipo' = 'receber_bv')
              and not exists (select 1 from fornecedores f where f.id = nullif(p.detalhe->>'fornecedor_id', '')::uuid)
         then 'comissão sem fornecedor definido' end
  ], null);
$$;
revoke execute on function public._fat_faltas_producao(producao) from public, anon, authenticated;

create or replace function public.fin_faturamento_fila(p_org uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public'
as $$
declare v jsonb;
begin
  if not fin_agente_folha(p_org) then raise exception 'Acesso negado' using errcode = '42501'; end if;
  select coalesce(jsonb_agg(row_to_json(t) order by t.tipo, t.numero), '[]'::jsonb) into v from (
    -- Mídia: o que a tela mostra (A Faturar e ainda sem lançamento).
    select 'midia' as tipo, m.id, m.numero,
           nullif(btrim(coalesce(m.serie, '') || ' ' || coalesce(m.numero::text, '')), '') as documento,
           m.titulo, w.id as cliente_id, w.name as cliente,
           'veiculo' as contraparte_tipo, ve.id as contraparte_id, ve.name as contraparte,
           m.valor::float8 as valor,
           (round(coalesce(m.valor, 0) * coalesce(m.desconto_pct, 0) / 100.0, 2)
             + round(round(_br_num(m.detalhe->>'producao_valor')
                 * greatest(coalesce(nullif(_br_num(m.detalhe->>'producao_quantidade'), 0), 1), 1), 2)
                 * _br_num(m.detalhe->>'producao_comissao_pct') / 100.0, 2))::float8 as a_receber,
           case when m.faturamento in ('valor_bruto', 'liquido_contra_agencia') then 'veiculo' else 'cliente' end as quem_paga,
           (_midia_vencimento(m.prazo, m.data_base, 0))::text as vencimento_contraparte,
           (_midia_vencimento(m.prazo, m.data_base, m.dias_agencia))::text as vencimento_agencia,
           exists (select 1 from jsonb_array_elements(coalesce(m.anexos, '[]')) x where x->>'tipo' = 'NF') as tem_nf,
           exists (select 1 from jsonb_array_elements(coalesce(m.anexos, '[]')) x where x->>'tipo' = 'Boleto') as tem_boleto,
           (select string_agg(x->>'numero', ',') from jsonb_array_elements(coalesce(m.anexos, '[]')) x where coalesce(x->>'numero', '') <> '') as numeros,
           _fat_faltas_midia(m) as faltas,
           m.updated_at::date::text as liberado_em
      from midias m
      left join workspaces w on w.id = m.workspace_id
      left join veiculos ve on ve.id = m.veiculo_id
     where m.org_id = p_org and m.situacao = 'faturar' and not m.archived
       and not exists (select 1 from lancamentos l where l.origem_id = m.id)
    union all
    -- Produção: Fee, Pedido, Venda e Proposta faturada nela mesma (tem parcelas).
    select 'producao', p.id, p.numero,
           nullif(btrim(coalesce(p.serie, '') || ' ' || coalesce(p.numero::text, '')), ''),
           p.titulo, w.id, w.name,
           case when f.id is not null then 'fornecedor' end, f.id, f.name,
           p.valor::float8,
           coalesce((select sum(coalesce(nullif(e->>'valor', '')::numeric, 0))
                       from jsonb_array_elements(coalesce(p.detalhe->'parcelas', '[]'::jsonb)) e
                      where e->>'tipo' in ('receber_bv', 'receber_honorarios', 'receber_cliente')), 0)::float8,
           p.tipo,
           (select min(e->>'vencimento') from jsonb_array_elements(coalesce(p.detalhe->'parcelas', '[]'::jsonb)) e
             where coalesce(e->>'vencimento', '') <> ''),
           (select min(e->>'vencimento') from jsonb_array_elements(coalesce(p.detalhe->'parcelas', '[]'::jsonb)) e
             where e->>'tipo' in ('receber_bv', 'receber_honorarios', 'receber_cliente') and coalesce(e->>'vencimento', '') <> ''),
           exists (select 1 from jsonb_array_elements(coalesce(p.anexos, '[]')) x where x->>'tipo' = 'NF'),
           exists (select 1 from jsonb_array_elements(coalesce(p.anexos, '[]')) x where x->>'tipo' = 'Boleto'),
           (select string_agg(x->>'numero', ',') from jsonb_array_elements(coalesce(p.anexos, '[]')) x where coalesce(x->>'numero', '') <> ''),
           _fat_faltas_producao(p),
           p.updated_at::date::text
      from producao p
      left join workspaces w on w.id = p.workspace_id
      left join fornecedores f on f.id = nullif(p.detalhe->>'fornecedor_id', '')::uuid
     where p.org_id = p_org and p.situacao = 'faturar' and not p.archived
       and p.tipo in ('fee', 'pedido', 'venda', 'proposta')
       and (p.tipo <> 'proposta' or jsonb_array_length(coalesce(p.detalhe->'parcelas', '[]'::jsonb)) > 0)
  ) t;
  return v;
end $$;
revoke execute on function public.fin_faturamento_fila(uuid) from public, anon;
grant execute on function public.fin_faturamento_fila(uuid) to authenticated;

-- Fatura UM documento da fila. Re-confere tudo no banco: a fila que a Flávia leu
-- pode ter mudado (alguém faturou pela tela, editou o valor, arquivou).
create or replace function public.fin_faturar_agente(p_org uuid, p_tipo text, p_id uuid)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  m midias; p producao; v_faltas text[]; v_conta uuid; v_lanc jsonb; v_docs jsonb;
begin
  if not fin_agente_folha(p_org) then raise exception 'Acesso negado' using errcode = '42501'; end if;
  -- Conta a receber padrão = a favorita da org, como a tela.
  select id into v_conta from contas_financeiras
   where org_id = p_org and ativo order by favorita desc nulls last, ordem nulls last limit 1;

  if p_tipo = 'midia' then
    select * into m from midias where id = p_id and org_id = p_org for update;
    if not found then raise exception 'Mídia não encontrada'; end if;
    if m.situacao <> 'faturar' or m.archived then raise exception 'Documento não está mais em A Faturar'; end if;
    if exists (select 1 from lancamentos where origem_id = p_id) then raise exception 'Documento já tem lançamento'; end if;
    v_faltas := _fat_faltas_midia(m);
    if cardinality(v_faltas) > 0 then raise exception 'Falta: %', array_to_string(v_faltas, ', '); end if;
    update midias set situacao = 'faturado', updated_at = now() where id = p_id;
    perform gerar_lancamento_midia(p_id, v_conta, null, null, null);
    -- NF/boleto do VEÍCULO que já estavam no documento seguem para o lançamento
    -- da comissão: é por eles que a régua de NF para de pedir e que a NFS-e da
    -- agência sabe que pode sair.
    v_docs := (select coalesce(jsonb_agg(x || jsonb_build_object('emitente', 'fornecedor')), '[]'::jsonb)
                 from jsonb_array_elements(coalesce(m.anexos, '[]')) x where x->>'tipo' in ('NF', 'Boleto'));
    if jsonb_array_length(v_docs) > 0 then
      update lancamentos set anexos = coalesce(anexos, '[]'::jsonb) || v_docs
       where origem_tipo = 'midia' and origem_id = p_id and coalesce(origem_parte, 'veiculacao') = 'veiculacao';
    end if;
  elsif p_tipo = 'producao' then
    select * into p from producao where id = p_id and org_id = p_org for update;
    if not found then raise exception 'Documento não encontrado'; end if;
    if p.situacao <> 'faturar' or p.archived then raise exception 'Documento não está mais em A Faturar'; end if;
    v_faltas := _fat_faltas_producao(p);
    if cardinality(v_faltas) > 0 then raise exception 'Falta: %', array_to_string(v_faltas, ', '); end if;
    update producao set situacao = 'faturado', updated_at = now() where id = p_id;
    perform gerar_lancamentos_producao(p_id, v_conta, null, null, null);
  else
    raise exception 'Tipo inválido';
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
           'lancamento_id', l.id, 'contato_tipo', l.contato_tipo, 'contato', l.contato_nome,
           'descricao', l.descricao, 'valor', l.valor::float8, 'vencimento', l.vencimento::text,
           'nf_fornecedor', exists (select 1 from jsonb_array_elements(l.anexos) x
                                     where x->>'tipo' = 'NF' and x->>'emitente' = 'fornecedor'))
           order by l.vencimento), '[]'::jsonb)
    into v_lanc from lancamentos l where l.origem_id = p_id;
  return jsonb_build_object('ok', true, 'lancamentos', v_lanc);
end $$;
revoke execute on function public.fin_faturar_agente(uuid, text, uuid) from public, anon;
grant execute on function public.fin_faturar_agente(uuid, text, uuid) to authenticated;

-- NF/boleto que chega com o documento ainda na fila: entra nos anexos do
-- documento (o "NF · Boleto" da tela de Faturamento). Só acrescenta; repetido
-- (mesmo tipo + número) não entra duas vezes.
create or replace function public.fin_anexar_documento_fila(p_org uuid, p_tipo text, p_id uuid, p_anexo jsonb)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare v_anexos jsonb;
begin
  if not fin_agente_folha(p_org) then raise exception 'Acesso negado' using errcode = '42501'; end if;
  if coalesce(p_anexo->>'tipo', '') not in ('NF', 'Boleto') or coalesce(p_anexo->>'url', '') = '' then
    raise exception 'Anexo inválido';
  end if;
  if p_tipo = 'midia' then
    select anexos into v_anexos from midias where id = p_id and org_id = p_org for update;
  elsif p_tipo = 'producao' then
    select anexos into v_anexos from producao where id = p_id and org_id = p_org for update;
  else
    raise exception 'Tipo inválido';
  end if;
  if not found then raise exception 'Documento não encontrado'; end if;
  if coalesce(p_anexo->>'numero', '') <> '' and exists (
    select 1 from jsonb_array_elements(coalesce(v_anexos, '[]')) x
     where x->>'tipo' = p_anexo->>'tipo' and x->>'numero' = p_anexo->>'numero'
  ) then return jsonb_build_object('ok', true, 'repetido', true); end if;
  v_anexos := coalesce(v_anexos, '[]'::jsonb) || jsonb_build_array(jsonb_build_object(
    'url', p_anexo->>'url', 'nome', left(coalesce(p_anexo->>'nome', 'documento.pdf'), 200),
    'tipo', p_anexo->>'tipo', 'numero', left(coalesce(p_anexo->>'numero', ''), 40)));
  if p_tipo = 'midia' then update midias set anexos = v_anexos where id = p_id;
  else update producao set anexos = v_anexos where id = p_id; end if;
  return jsonb_build_object('ok', true);
end $$;
revoke execute on function public.fin_anexar_documento_fila(uuid, text, uuid, jsonb) from public, anon;
grant execute on function public.fin_anexar_documento_fila(uuid, text, uuid, jsonb) to authenticated;

-- Lançamentos de faturamento ainda sem NFS-e da agência. "pronto" segue a regra
-- do Rafael (28/10): sai quando a NF do veículo/fornecedor já está anexada; sem
-- ela, espera o mês do vencimento chegar. Vencido sem nota fica de fora: isso
-- não é rotina, é caso para o Rafael olhar.
create or replace function public.fin_nfse_a_emitir(p_org uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public'
as $$
declare v jsonb; v_hoje date := fin_hoje();
begin
  if not fin_agente_folha(p_org) then raise exception 'Acesso negado' using errcode = '42501'; end if;
  select coalesce(jsonb_agg(row_to_json(t) order by t.vencimento), '[]'::jsonb) into v from (
    select l.id as lancamento_id, l.contato_tipo, l.contato_nome as contato,
           nullif(btrim(coalesce(d.doc_serie, '') || ' ' || coalesce(d.doc_numero::text, '')), '') as documento,
           l.descricao, l.valor::float8 as valor, l.vencimento::text as vencimento,
           l.parcela_num, l.parcela_total,
           exists (select 1 from jsonb_array_elements(coalesce(l.anexos, '[]')) x
                    where x->>'tipo' = 'NF' and x->>'emitente' = 'fornecedor') as nf_fornecedor,
           (exists (select 1 from jsonb_array_elements(coalesce(l.anexos, '[]')) x
                     where x->>'tipo' = 'NF' and x->>'emitente' = 'fornecedor')
            or date_trunc('month', l.vencimento) <= date_trunc('month', v_hoje)) as pronto
      from lancamentos l
      join lancamentos_doc d on d.id = l.id
     where l.org_id = p_org and l.tipo = 'entrada' and l.situacao = 'em_aberto'
       and l.origem_tipo in ('midia', 'producao') and l.vencimento >= v_hoje
       and not coalesce(l.nf_emitida, false)
       and not exists (select 1 from nota_fiscal n where n.lancamento_id = l.id and n.status in ('autorizada', 'pendente'))
       and not exists (select 1 from jsonb_array_elements(coalesce(l.anexos, '[]')) x
                        where x->>'tipo' = 'NF' and coalesce(x->>'emitente', 'agencia') = 'agencia')
  ) t;
  return v;
end $$;
revoke execute on function public.fin_nfse_a_emitir(uuid) from public, anon;
grant execute on function public.fin_nfse_a_emitir(uuid) to authenticated;

notify pgrst, 'reload schema';
