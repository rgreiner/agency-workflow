-- 370_cotacao_cliente_e_comissao.sql
-- Fornecedores pediram (26/10): o link da cotação precisa dizer PARA QUEM é (alguns
-- conferem o cadastro do cliente antes de mandar preço), contra quem faturar e se há
-- comissão da agência, com o percentual. A 310 escondia o cliente de propósito; o
-- Rafael decidiu mostrar.
--
-- Mesma assinatura da 311 (create or replace mantém os grants: só flow_auth executa).
-- Idempotente.

create or replace function cotacao_por_token(p_token text, p_trava boolean)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v jsonb; v_prod uuid;
begin
  select c.producao_id into v_prod
    from cotacao_convites cv join cotacoes c on c.id = cv.cotacao_id
   where cv.token = p_token;
  if v_prod is null then return null; end if;
  if p_trava then perform 1 from producao where id = v_prod for update; end if;

  select jsonb_build_object(
    'id', cv.id, 'org_id', cv.org_id, 'cotacao_id', cv.cotacao_id, 'fornecedor_id', cv.fornecedor_id,
    'producao_id', c.producao_id, 'titulo', p.titulo, 'agencia', o.name, 'org_slug', o.slug,
    'responsavel', pr.full_name, 'responsavel_email', pr.email,
    'mensagem', c.mensagem, 'prazo_resposta', to_char(c.prazo_resposta, 'YYYY-MM-DD'), 'encerrada', c.encerrada,
    'itens', c.itens, 'anexos', c.anexos,
    'fornecedor', jsonb_build_object('nome', f.name, 'tax_id', f.tax_id, 'emails', f.emails, 'telefones', f.telefones),
    'resposta', cv.resposta, 'resposta_anexos', cv.resposta_anexos, 'dados_fornecedor', cv.dados_fornecedor,
    'respondido_em', cv.respondido_em, 'recusado_em', cv.recusado_em, 'aberto_em', cv.aberto_em,
    'detalhe_itens', coalesce(p.detalhe->'itens', 'null'::jsonb),
    -- 370: quem é o cliente, contra quem faturar e a comissão da agência.
    'cliente', jsonb_build_object(
      'nome', w.name, 'razao', w.legal_name, 'cnpj', w.tax_id,
      'cidade', w.address_city, 'uf', w.address_state,
      'endereco', concat_ws(', ', nullif(w.address_street, ''), nullif(w.address_number, ''), nullif(w.address_district, ''))),
    'faturar', p.faturar,
    'comissao_pct', p.bv_pct
  ) into v
    from cotacao_convites cv
    join cotacoes c on c.id = cv.cotacao_id
    join producao p on p.id = c.producao_id
    join organizations o on o.id = cv.org_id
    join fornecedores f on f.id = cv.fornecedor_id
    left join profiles pr on pr.id = coalesce(p.responsavel_id, c.created_by)
    left join workspaces w on w.id = p.workspace_id
   where cv.token = p_token;
  return v;
end $$;


notify pgrst, 'reload schema';
