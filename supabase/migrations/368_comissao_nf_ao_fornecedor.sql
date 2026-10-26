-- 368 — comissão da PP/MX: NFS-e da agência + Pix ao fornecedor/veículo (26/10/2026)
--
-- Item 6 do ciclo da PP (fluxo ideal do Rafael, caso PP 1927). Depois que a NF
-- do fornecedor chega e é anexada, a comissão da agência:
--   a) precisa da NFS-e — quem emite é o Rafael, pela tela do lançamento;
--      a Flávia só mostra a fila ("a_emitir");
--   b) emitida, a NF vai por e-mail ao fornecedor ("Comissão | PP 1927"), com o
--      Pix — o boleto da agência depende da integração BTG ("a_enviar").
-- O envio fica registrado em cobranca_avisos (bucket 'comissao_nf'), então
-- não repete. Notas emitidas ANTES de 27/10/2026 ficam de fora: essas a Erika já
-- mandou à mão, e reenviar confundiria o fornecedor.
create or replace function public.fin_comissoes_nf(p_org uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public'
as $$
declare v_emitir jsonb; v_enviar jsonb;
begin
  if not fin_can(p_org) then raise exception 'Acesso negado' using errcode = '42501'; end if;

  with base as (
    select l.id, l.contato_tipo, coalesce(f.name, ve.name, l.contato_nome) as fornecedor,
           _fin_contato_cadastro(coalesce(f.emails, ve.emails), coalesce(f.telefones, ve.telefones)) as contato,
           nullif(btrim(coalesce(d.doc_serie, '') || ' ' || coalesce(d.doc_numero::text, '')), '') as documento,
           l.valor::float8 as valor, l.vencimento, l.nf_emitida, l.anexos
      from lancamentos l
      join lancamentos_doc d on d.id = l.id
      left join fornecedores f on l.contato_tipo = 'fornecedor' and f.id = l.contato_id
      left join veiculos ve    on l.contato_tipo = 'veiculo'    and ve.id = l.contato_id
     where l.org_id = p_org and l.tipo = 'entrada' and l.situacao = 'em_aberto'
       and l.origem_tipo in ('producao', 'midia') and l.contato_tipo in ('fornecedor', 'veiculo')
  )
  select
    coalesce((select jsonb_agg(jsonb_build_object('titulo_id', b.id, 'documento', b.documento, 'fornecedor', b.fornecedor,
                'valor', b.valor, 'vencimento', b.vencimento) order by b.vencimento nulls last)
       from base b
      where not b.nf_emitida
        and not exists (select 1 from nota_fiscal n where n.lancamento_id = b.id and n.status = 'autorizada')
        and exists (select 1 from jsonb_array_elements(b.anexos) x where x->>'tipo' = 'NF' and x->>'emitente' = 'fornecedor')), '[]'::jsonb),
    coalesce((select jsonb_agg(jsonb_build_object('titulo_id', b.id, 'documento', b.documento, 'fornecedor', b.fornecedor,
                'contato_nome', b.contato->>'nome', 'email', b.contato->>'email',
                'valor', b.valor, 'vencimento', b.vencimento, 'nota_numero', n.numero) order by b.vencimento nulls last)
       from base b
       join lateral (select n.numero from nota_fiscal n
                      where n.lancamento_id = b.id and n.status = 'autorizada' and n.ambiente = 'producao'
                        and n.emitido_em >= '2026-10-27'::date
                      order by n.emitido_em desc limit 1) n on true
      where b.contato->>'email' is not null
        and not exists (select 1 from cobranca_avisos ca where ca.lancamento_id = b.id and ca.bucket = 'comissao_nf')), '[]'::jsonb)
    into v_emitir, v_enviar;

  return jsonb_build_object('a_emitir', v_emitir, 'a_enviar', v_enviar);
end $$;
revoke execute on function public.fin_comissoes_nf(uuid) from public, anon;
grant execute on function public.fin_comissoes_nf(uuid) to authenticated;

notify pgrst, 'reload schema';
