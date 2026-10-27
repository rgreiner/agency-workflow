-- 374 — pedido de NF ao fornecedor: 1º aviso 15 dias antes do vencimento, reforço 7 dias antes (27/10/2026)
--
-- Decisão do Rafael (27/10): o alerta de NF que não chegou começa 15 dias (corridos)
-- antes do vencimento — antes disso a NF não é cobrada — e reforça 7 dias antes.
-- Degraus: nf_email (a partir de vencimento-15) → nf_whats (2 úteis depois, sem
-- resposta) → nf_pre (reforço, de vencimento-7 em diante, uma vez, se o último aviso
-- já tem 2 úteis) → nf_lembrete_N (a cada 3 úteis depois do vencimento).

create or replace function public.fin_nf_fornecedor_pendente(p_org uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public'
as $$
declare v jsonb; v_hoje date := fin_hoje();
begin
  if not fin_can(p_org) then raise exception 'Acesso negado' using errcode = '42501'; end if;
  if not fin_dia_util(p_org, v_hoje) then return '[]'::jsonb; end if;

  select coalesce(jsonb_agg(row_to_json(t) order by t.fornecedor, t.vencimento), '[]'::jsonb) into v from (
    with base as (
      select l.id as lancamento_id, l.contato_tipo, l.contato_id,
             coalesce(f.name, ve.name) as fornecedor,
             _fin_contato_cadastro(coalesce(f.emails, ve.emails), coalesce(f.telefones, ve.telefones)) as contato,
             nullif(btrim(coalesce(d.doc_serie, '') || ' ' || coalesce(d.doc_numero::text, '')), '') as documento,
             coalesce(nullif(l.descricao, ''), 'Comissão') as descricao,
             l.valor::float8 as valor, l.vencimento
        from lancamentos l
        join lancamentos_doc d on d.id = l.id
        left join fornecedores f on l.contato_tipo = 'fornecedor' and f.id = l.contato_id and not f.archived
        left join veiculos ve    on l.contato_tipo = 'veiculo'    and ve.id = l.contato_id and not ve.archived
       where l.org_id = p_org and l.tipo = 'entrada' and l.situacao = 'em_aberto'
         and l.origem_tipo in ('producao', 'midia') and l.contato_tipo in ('fornecedor', 'veiculo')
         and l.vencimento is not null and coalesce(f.id, ve.id) is not null
         and not exists (select 1 from jsonb_array_elements(l.anexos) x where x->>'tipo' = 'NF' and x->>'emitente' = 'fornecedor')
         and l.vencimento - v_hoje <= 15   -- só entra na lista a partir de 15 dias antes do vencimento
    ), hist as (
      select b.*,
             (select max(sent_at) from cobranca_avisos ca where ca.lancamento_id = b.lancamento_id and ca.bucket = 'nf_email') as em_email,
             (select max(sent_at) from cobranca_avisos ca where ca.lancamento_id = b.lancamento_id and ca.bucket = 'nf_whats') as em_whats,
             (select max(sent_at) from cobranca_avisos ca where ca.lancamento_id = b.lancamento_id and ca.bucket like 'nf\_%') as ultimo,
             (select count(*) from cobranca_avisos ca where ca.lancamento_id = b.lancamento_id and ca.bucket like 'nf\_lembrete\_%') as lembretes
        from base b
    ), passo as (
      select h.*, case
          when h.em_email is null and h.em_whats is null and h.contato->>'email' is not null then 'nf_email'
          when h.em_whats is null and h.contato->>'telefone' is not null
               and (h.em_email is null or fin_dias_uteis_entre(p_org, (h.em_email at time zone 'America/Sao_Paulo')::date, v_hoje) >= 2) then 'nf_whats'
          -- reforço 7 dias antes do vencimento (uma vez), se o último aviso já tem 2 úteis
          when v_hoje <= h.vencimento and v_hoje >= h.vencimento - 7 and h.ultimo is not null
               and not exists (select 1 from cobranca_avisos ca where ca.lancamento_id = h.lancamento_id and ca.bucket = 'nf_pre')
               and fin_dias_uteis_entre(p_org, (h.ultimo at time zone 'America/Sao_Paulo')::date, v_hoje) >= 2 then 'nf_pre'
          when v_hoje > h.vencimento and h.ultimo is not null
               and fin_dias_uteis_entre(p_org, (h.ultimo at time zone 'America/Sao_Paulo')::date, v_hoje) >= 3 then 'nf_lembrete_' || (h.lembretes + 1)
        end as bucket
        from hist h
    )
    select p.lancamento_id, p.contato_tipo, p.contato_id, p.fornecedor,
           p.contato->>'nome' as contato_nome, p.contato->>'email' as email, p.contato->>'telefone' as telefone,
           p.documento, p.descricao, p.valor, p.vencimento::text as vencimento,
           (v_hoje - p.vencimento) as dias, p.bucket, (p.em_email is null and p.em_whats is null) as primeiro,
           case when p.bucket = 'nf_email' then 'email'
                when p.bucket = 'nf_whats' then 'whatsapp'
                when p.bucket = 'nf_pre' and p.contato->>'email' is not null then 'email'
                when p.contato->>'telefone' is not null then 'whatsapp' else 'email' end as canal
      from passo p
     where p.bucket is not null
       and (p.contato->>'email' is not null or p.contato->>'telefone' is not null)
  ) t;
  return v;
end $$;
revoke execute on function public.fin_nf_fornecedor_pendente(uuid) from public, anon;
grant execute on function public.fin_nf_fornecedor_pendente(uuid) to authenticated;

notify pgrst, 'reload schema';
