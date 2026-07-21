-- 133_anexo_por_parcela.sql
-- Fee/Pedido parcelado: a NF e o boleto são de UM mês, não do contrato inteiro.
--
-- gerar_lancamentos_producao copiava `p.anexos` (o que foi recolhido na
-- conferência do Faturamento) para TODAS as parcelas. Um Fee de 12 meses nascia
-- com a NF de julho colada em julho, agosto, setembro… até junho do ano seguinte.
-- Medido em produção: "Times Digitais - NF 2162.pdf" em 12 lançamentos,
-- "IMDM - NF 2151.pdf" em 12.
--
-- Passa a copiar só na PRIMEIRA parcela de cada série (menor vencimento), que é
-- justamente o documento que a pessoa tinha em mãos na conferência. As demais
-- nascem vazias e recebem a sua NF/boleto quando o mês chegar.
--
-- De quebra: parcela_num/parcela_total nunca eram preenchidos nos lançamentos de
-- produção (0 de 25 em produção), então 12 linhas idênticas "Fee 2026" ficavam
-- indistinguíveis na lista. Agora saem numeradas (1/12 … 12/12).
--
-- Idempotente.

create or replace function gerar_lancamentos_producao(p_producao_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare p record; forn_nome text;
begin
  select pr.*, w.name as cliente_nome into p
    from producao pr join workspaces w on w.id = pr.workspace_id
    where pr.id = p_producao_id;
  if not found then return; end if;
  if p.tipo not in ('pedido', 'fee', 'proposta') then return; end if;

  if exists (
    select 1 from lancamentos where origem_tipo = 'producao' and origem_id = p_producao_id and situacao in ('recebido','pago')
  ) then return; end if;

  delete from lancamentos where origem_tipo = 'producao' and origem_id = p_producao_id;

  if p.situacao <> 'faturado' then return; end if;

  select name into forn_nome from fornecedores where id = nullif(p.detalhe->>'fornecedor_id','')::uuid;

  -- Uma inserção só: precisamos da ORDEM das parcelas (quem é a primeira) e do
  -- total por série, e isso é janela — não dá no laço linha a linha de antes.
  insert into lancamentos (
    org_id, tipo, origem_tipo, origem_id, contato_tipo, contato_nome,
    descricao, valor, vencimento, competencia, situacao, anexos,
    parcela_num, parcela_total, created_by
  )
  select
    p.org_id, 'entrada', 'producao', p_producao_id, x.ct, x.cn, x.descr,
    x.valor, x.venc, x.venc, 'em_aberto',
    -- Só a primeira parcela herda a NF/boleto da conferência.
    case when x.rn = 1 then coalesce(p.anexos, '[]'::jsonb) else '[]'::jsonb end,
    -- Parcela única não vira "1/1" — isso é ruído na lista.
    case when x.total > 1 then x.rn::int end,
    case when x.total > 1 then x.total::int end,
    p.created_by
  from (
    select b.*,
           row_number() over (partition by b.descr order by b.venc nulls last, b.ord) as rn,
           count(*)     over (partition by b.descr)                                   as total
      from (
        select
          case e.parc->>'tipo'
            when 'receber_bv'         then 'fornecedor'
            else                           'cliente'
          end as ct,
          case e.parc->>'tipo'
            when 'receber_bv'         then coalesce(forn_nome, 'Fornecedor')
            else                           p.cliente_nome
          end as cn,
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
end; $$;

grant execute on function gerar_lancamentos_producao(uuid) to anon, authenticated;

-- ── Conserto do que já foi gerado ───────────────────────────────────────────
-- (1) Numera as parcelas existentes (por série de descrição, na ordem do vencimento).
with ranked as (
  select id,
         row_number() over (partition by origem_id, descricao order by vencimento nulls last, created_at, id) as rn,
         count(*)     over (partition by origem_id, descricao)                                                as total
    from lancamentos
   where origem_tipo = 'producao'
)
update lancamentos l
   set parcela_num   = case when r.total > 1 then r.rn::int end,
       parcela_total = case when r.total > 1 then r.total::int end,
       updated_at    = now()
  from ranked r
 where r.id = l.id
   and (l.parcela_num is distinct from case when r.total > 1 then r.rn::int end
     or l.parcela_total is distinct from case when r.total > 1 then r.total::int end);

-- (2) Tira das parcelas 2..N apenas os anexos que VIERAM DO DOCUMENTO (nome
--     idêntico). Anexo posto à mão numa parcela fica — existe pelo menos um caso
--     em produção ("IMDM - boleto 2151.pdf", minúsculo, diferente do nome no doc),
--     e apagar trabalho manual pra corrigir um bug do sistema seria pior que o bug.
with ranked as (
  select l.id, l.origem_id,
         row_number() over (partition by l.origem_id, l.descricao order by l.vencimento nulls last, l.created_at, l.id) as rn
    from lancamentos l
   where l.origem_tipo = 'producao'
)
update lancamentos l
   set anexos = coalesce((
         select jsonb_agg(a)
           from jsonb_array_elements(coalesce(l.anexos, '[]'::jsonb)) a
          where not exists (
            select 1 from producao pr, lateral jsonb_array_elements(coalesce(pr.anexos, '[]'::jsonb)) d
             where pr.id = l.origem_id and d->>'nome' = a->>'nome')
       ), '[]'::jsonb),
       updated_at = now()
  from ranked r
 where r.id = l.id
   and r.rn > 1
   and jsonb_array_length(coalesce(l.anexos, '[]'::jsonb)) > 0;

notify pgrst, 'reload schema';
