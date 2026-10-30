-- 394 — Régua completa da comissão de veículo/fornecedor (Rafael, 30/10/2026)
--
-- Passos: D-30, D-15, D-3 (lembretes), D0 (vence hoje), D+3, D+7, D+15, D+30, D+60
-- (cobranças). Substitui os 3 degraus pós-vencimento da 376 (D+3 e +5 úteis).
--
-- • Como na régua do cliente: sai o MAIOR passo já alcançado e ainda não avisado
--   (sem escada retroativa) — passo que cai em fim de semana sai no próximo dia útil.
-- • Lembrete (antes do vencimento) só depois que a NFS-e foi ao veículo
--   (aviso 'comissao_nf'): lembrar de nota que ele nem recebeu não faz sentido.
-- • Bucket = 'comissao_' || fin_bucket(passo) ('comissao_d-30', 'comissao_d+7'…).
--   Títulos que já tiveram cobrança no modelo antigo ('comissao_cob_N') seguem: o
--   próximo passo alcançado sai normalmente.
-- • Vai para o Rafael ("com_rafael"): D+60 já avisado, 3 cobranças do modelo antigo,
--   ou vencida sem e-mail no cadastro.
-- • Promessa em dia (promessa_data >= hoje) segura a régua, como antes.
-- Saída ganha `passo` (int) — o Digitais escolhe o texto por ele.

create or replace function public.fin_regua_comissao(p_org uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public'
as $$
declare
  v_hoje date := fin_hoje();
  v_passos int[] := array[-30, -15, -3, 0, 3, 7, 15, 30, 60];
  v_cobrar jsonb; v_esgotadas jsonb;
begin
  if not fin_can(p_org) then raise exception 'Acesso negado' using errcode = '42501'; end if;

  with base as (
    select l.id, coalesce(f.name, ve.name, l.contato_nome) as fornecedor,
           _fin_contato_cadastro(coalesce(f.emails, ve.emails), coalesce(f.telefones, ve.telefones)) as contato,
           nullif(btrim(coalesce(d.doc_serie, '') || ' ' || coalesce(d.doc_numero::text, '')), '') as documento,
           round(l.valor - coalesce(l.valor_realizado, 0), 2)::float8 as valor, l.vencimento,
           v_hoje - l.vencimento as dias,
           (select max(p) from unnest(v_passos) p where p <= v_hoje - l.vencimento) as passo,
           exists (select 1 from cobranca_avisos ca where ca.lancamento_id = l.id and ca.bucket = 'comissao_nf') as nf_enviada,
           (select count(*) from cobranca_avisos ca where ca.lancamento_id = l.id and ca.bucket like 'comissao\_cob\_%') as antigos,
           exists (select 1 from cobranca_avisos ca where ca.lancamento_id = l.id and ca.bucket = 'comissao_d+60') as ultimo_feito
      from lancamentos l
      join lancamentos_doc d on d.id = l.id
      left join fornecedores f on l.contato_tipo = 'fornecedor' and f.id = l.contato_id
      left join veiculos ve    on l.contato_tipo = 'veiculo'    and ve.id = l.contato_id
     where l.org_id = p_org and l.tipo = 'entrada' and l.situacao = 'em_aberto'
       and l.origem_tipo in ('producao', 'midia') and l.contato_tipo in ('fornecedor', 'veiculo')
       and l.vencimento is not null and l.vencimento <= v_hoje + 30
       and round(l.valor - coalesce(l.valor_realizado, 0), 2) > 0
       and (l.promessa_data is null or l.promessa_data < v_hoje)
  )
  select
    coalesce((select jsonb_agg(jsonb_build_object('titulo_id', b.id, 'documento', b.documento, 'fornecedor', b.fornecedor,
                'contato_nome', b.contato->>'nome', 'email', b.contato->>'email', 'valor', b.valor,
                'vencimento', b.vencimento, 'dias', b.dias, 'passo', b.passo, 'bucket', 'comissao_' || fin_bucket(b.passo))
                order by b.vencimento)
       from base b
      where fin_dia_util(p_org, v_hoje) and b.contato->>'email' is not null and b.passo is not null
        and not b.ultimo_feito and b.antigos < 3
        and (b.passo > 0 or b.nf_enviada)
        and not exists (select 1 from cobranca_avisos ca where ca.lancamento_id = b.id and ca.bucket = 'comissao_' || fin_bucket(b.passo))), '[]'::jsonb),
    coalesce((select jsonb_agg(jsonb_build_object('titulo_id', b.id, 'documento', b.documento, 'fornecedor', b.fornecedor,
                'valor', b.valor, 'vencimento', b.vencimento, 'dias', b.dias,
                'motivo', case when b.contato->>'email' is null then 'sem e-mail no cadastro'
                               when b.antigos >= 3 then '3 cobranças sem pagamento'
                               else 'régua completa (D+60) sem pagamento' end)
                order by b.vencimento)
       from base b
      where b.dias > 0 and (b.ultimo_feito or b.antigos >= 3 or b.contato->>'email' is null)), '[]'::jsonb)
    into v_cobrar, v_esgotadas;

  return jsonb_build_object('a_cobrar', v_cobrar, 'com_rafael', v_esgotadas);
end $$;
revoke execute on function public.fin_regua_comissao(uuid) from public, anon;
grant execute on function public.fin_regua_comissao(uuid) to authenticated;

notify pgrst, 'reload schema';
