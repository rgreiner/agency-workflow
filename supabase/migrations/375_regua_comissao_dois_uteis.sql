-- 375 — 1ª cobrança da comissão em atraso só no 2º dia útil depois do vencimento (27/10/2026)
--
-- MX 1638 (LEDLEX): venceu 26/10, entrou no BTG 27/10 e às 9h30 do mesmo 27/10 a
-- Flávia já propôs a cobrança — o extrato do dia ainda nem existia. Boleto/Pix pago
-- no vencimento só aparece no extrato do dia seguinte; com 2 úteis de folga o
-- pagamento em dia já está conciliado quando a régua olha. Degraus 2 e 3 seguem a
-- 5 úteis do anterior.

create or replace function public.fin_regua_comissao(p_org uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public'
as $$
declare v_hoje date := fin_hoje(); v_cobrar jsonb; v_esgotadas jsonb;
begin
  if not fin_can(p_org) then raise exception 'Acesso negado' using errcode = '42501'; end if;

  with base as (
    select l.id, coalesce(f.name, ve.name, l.contato_nome) as fornecedor,
           _fin_contato_cadastro(coalesce(f.emails, ve.emails), coalesce(f.telefones, ve.telefones)) as contato,
           nullif(btrim(coalesce(d.doc_serie, '') || ' ' || coalesce(d.doc_numero::text, '')), '') as documento,
           round(l.valor - coalesce(l.valor_realizado, 0), 2)::float8 as valor, l.vencimento,
           (select count(*) from cobranca_avisos ca where ca.lancamento_id = l.id and ca.bucket like 'comissao\_cob\_%') as feitos,
           (select max(sent_at) from cobranca_avisos ca where ca.lancamento_id = l.id and ca.bucket like 'comissao\_cob\_%') as ultimo
      from lancamentos l
      join lancamentos_doc d on d.id = l.id
      left join fornecedores f on l.contato_tipo = 'fornecedor' and f.id = l.contato_id
      left join veiculos ve    on l.contato_tipo = 'veiculo'    and ve.id = l.contato_id
     where l.org_id = p_org and l.tipo = 'entrada' and l.situacao = 'em_aberto'
       and l.origem_tipo in ('producao', 'midia') and l.contato_tipo in ('fornecedor', 'veiculo')
       and l.vencimento < v_hoje
       and round(l.valor - coalesce(l.valor_realizado, 0), 2) > 0
       and (l.promessa_data is null or l.promessa_data < v_hoje)
  )
  select
    coalesce((select jsonb_agg(jsonb_build_object('titulo_id', b.id, 'documento', b.documento, 'fornecedor', b.fornecedor,
                'contato_nome', b.contato->>'nome', 'email', b.contato->>'email', 'valor', b.valor,
                'vencimento', b.vencimento, 'dias', v_hoje - b.vencimento, 'bucket', 'comissao_cob_' || (b.feitos + 1))
                order by b.vencimento)
       from base b
      where fin_dia_util(p_org, v_hoje) and b.contato->>'email' is not null and b.feitos < 3
        and fin_dias_uteis_entre(p_org, coalesce((b.ultimo at time zone 'America/Sao_Paulo')::date, b.vencimento), v_hoje)
            >= case when b.feitos = 0 then 2 else 5 end), '[]'::jsonb),
    coalesce((select jsonb_agg(jsonb_build_object('titulo_id', b.id, 'documento', b.documento, 'fornecedor', b.fornecedor,
                'valor', b.valor, 'vencimento', b.vencimento, 'dias', v_hoje - b.vencimento,
                'motivo', case when b.contato->>'email' is null then 'sem e-mail no cadastro' else '3 cobranças sem pagamento' end)
                order by b.vencimento)
       from base b
      where b.feitos >= 3 or b.contato->>'email' is null), '[]'::jsonb)
    into v_cobrar, v_esgotadas;

  return jsonb_build_object('a_cobrar', v_cobrar, 'com_rafael', v_esgotadas);
end $$;
revoke execute on function public.fin_regua_comissao(uuid) from public, anon;
grant execute on function public.fin_regua_comissao(uuid) to authenticated;

notify pgrst, 'reload schema';
