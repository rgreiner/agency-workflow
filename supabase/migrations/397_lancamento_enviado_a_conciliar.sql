-- 397 — "Enviado, a conciliar": pagamento disparado não é pagamento feito (30/10/2026)
--
-- Rafael, 30/10: "só considero pago ao conciliar". A baixa rápida da tela Hoje
-- (mig. 395) liquidava o título na hora; o saldo do Flow caía antes do extrato e o
-- BTG acusou "Não bate com o banco" de R$ 22.613,79 — exatamente as 15 baixas do dia.
--
-- Agora o título continua EM ABERTO e ganha a marca `enviado_em` (data em que o Pix
-- ou o boleto foi disparado — ou, numa entrada, em que o cliente avisou que pagou).
-- Quem liquida é a conciliação, com a data e o valor do banco. O saldo da conta só
-- se move com o extrato; a marca só tira o título da lista "a fazer".

alter table lancamentos add column if not exists enviado_em date;
alter table lancamentos add column if not exists enviado_por uuid;

-- A view da tela de Lançamentos ganha a coluna (no fim — create or replace só acrescenta).
create or replace view lancamentos_doc with (security_invoker = true) as
 SELECT l.id, l.org_id, l.tipo, l.origem_tipo, l.origem_id, l.contato_tipo, l.contato_nome,
    l.descricao, l.valor, l.vencimento, l.situacao, l.conta_corrente_id, l.created_by,
    l.created_at, l.updated_at, l.competencia, l.nf_emitida, l.boleto_gerado, l.conta_id,
    l.categoria, l.centro_custo, l.data_liquidacao, l.valor_realizado, l.juros, l.multa,
    l.desconto, l.tarifa, l.forma_pagamento, l.observacao, l.recorrente, l.parcela_num,
    l.parcela_total, l.grupo_id, l.anexos, l.origem_ref, l.revisar,
    COALESCE(p.serie, m.serie) AS doc_serie,
    COALESCE(p.numero, m.numero) AS doc_numero,
    CASE WHEN p.id IS NOT NULL THEN 'producao'::text
         WHEN m.id IS NOT NULL THEN 'midia'::text
         ELSE NULL::text END AS doc_origem,
    p.tipo AS doc_producao_tipo,
    l.transferencia_id,
    l.enviado_em
   FROM lancamentos l
     LEFT JOIN producao p ON l.origem_tipo = 'producao'::text AND p.id = l.origem_id
     LEFT JOIN midias m ON l.origem_tipo = 'midia'::text AND m.id = l.origem_id;

-- p_data null desmarca. Só título em aberto: o que já foi liquidado não "volta" a ser enviado.
create or replace function marcar_lancamento_enviado(p_lancamento_id uuid, p_data date)
returns void language plpgsql security definer set search_path = public as $$
declare l record;
begin
  select org_id, situacao, transferencia_id into l from lancamentos where id = p_lancamento_id;
  if l.org_id is null or not fin_can(l.org_id) then
    raise exception 'Acesso negado' using errcode = '42501';
  end if;
  if p_data is not null and l.situacao <> 'em_aberto' then
    raise exception 'Só título em aberto pode ser marcado como enviado';
  end if;
  if l.transferencia_id is not null then
    raise exception 'Transferência não passa por aqui';
  end if;
  update lancamentos
     set enviado_em = p_data,
         enviado_por = case when p_data is null then null else auth.uid() end,
         updated_at = now()
   where id = p_lancamento_id;
end $$;

revoke execute on function marcar_lancamento_enviado(uuid, date) from public, anon;
grant execute on function marcar_lancamento_enviado(uuid, date) to authenticated;

-- As 15 baixas rápidas de 30/10 (todas no BTG, nenhuma conciliada) voltam a ser
-- "enviado, a conciliar". Mesmo efeito do reabrir_lancamento + a marca.
update lancamentos l
   set situacao = 'em_aberto', data_liquidacao = null, valor_realizado = null,
       juros = 0, multa = 0, desconto = 0, tarifa = 0,
       enviado_em = '2026-10-30', enviado_por = '065d0f7d-ebe0-4b3d-9106-b24302992948', updated_at = now()
 where l.data_liquidacao = '2026-10-30'
   and l.situacao in ('pago', 'recebido')
   and l.transferencia_id is null
   and l.desmembrado_de is null
   and l.updated_at >= '2026-10-30'
   and not exists (select 1 from btg_conciliacao_itens i where i.lancamento_id = l.id);

CREATE OR REPLACE FUNCTION public.cobranca_payload()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v jsonb;
begin
  if not (is_cron() or is_psql_direto()) then
    raise exception 'Acesso negado' using errcode = '42501';
  end if;

  select coalesce(jsonb_agg(row_to_json(t)), '[]'::jsonb) into v from (
    with cfg as (
      select o.id as org_id, o.slug as org_slug, o.name as org_name,
             coalesce(os.payment_info, '') as payment_info,
             coalesce(os.cobranca_ativa, false) as ativa,
             coalesce(os.cobranca_regua, fin_regua_default()) as regua
        from organizations o
        left join org_settings os on os.org_id = o.id
    ),
    base as (
      select l.id, c.org_id, c.org_slug, c.org_name, c.payment_info, c.regua,
             w.name as cliente, w.finance_email as email,
             coalesce(nullif(l.descricao, ''), 'Cobrança') as descricao,
             round(l.valor - coalesce(l.valor_realizado, 0), 2) as falta,
             l.vencimento, (current_date - l.vencimento) as atraso
        from lancamentos l
        join cfg c        on c.org_id = l.org_id
        join workspaces w on w.id = l.workspace_id
       where l.tipo = 'entrada' and l.situacao = 'em_aberto'
         and c.ativa and c.payment_info <> ''
         and w.cobranca_auto and coalesce(w.finance_email, '') <> ''
         and l.vencimento is not null
         and round(l.valor - coalesce(l.valor_realizado, 0), 2) > 0
         and (l.promessa_data is null or l.promessa_data < current_date)
         -- Cliente avisou que pagou ("Recebido · a conciliar", mig. 397): espera o banco
         -- por 3 dias antes de voltar a cobrar.
         and (l.enviado_em is null or l.enviado_em < current_date - 3)
         -- Quem paga tem que ser o cliente: mesmo nome, ou alias explícito.
         and (
           fin_norm_nome(l.contato_nome) = fin_norm_nome(w.name)
           or exists (
             select 1 from cliente_aliases a
              where a.org_id = l.org_id
                and a.workspace_id = w.id
                and a.alias = fin_norm_nome(l.contato_nome))
         )
    ),
    escolha as (
      select b.*, (select max(x::int) from jsonb_array_elements_text(b.regua) x where x::int <= b.atraso) as passo
        from base b
    )
    select e.id as lancamento_id, fin_bucket(e.passo) as bucket,
           -- org_id é o que o job usa para achar o boleto do lançamento e
           -- mandá-lo anexo; sem ele a cobrança sai sem o documento de pagar.
           e.org_id, e.org_slug, e.org_name, e.cliente, e.email, e.descricao,
           e.falta::float8 as valor, e.vencimento::text as vencimento,
           e.atraso as dias, e.payment_info
      from escolha e
     where e.passo is not null
       and not exists (
         select 1 from cobranca_avisos ca
          where ca.lancamento_id = e.id and ca.canal <> 'manual' and ca.bucket = fin_bucket(e.passo))
  ) t;
  return v;
end $function$;

notify pgrst, 'reload schema';
