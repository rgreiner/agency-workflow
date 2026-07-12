-- 101_faturar_unificado.sql
-- Unifica o handoff pro Financeiro: 'faturar' (A Faturar) → 'faturado' (lançado).
-- (1) lancar_midia agora marca a mídia como 'faturado' E gera o lançamento (antes
--     exigia que já estivesse 'faturado'); a tela de Faturamento passa a listar mídia
--     em 'faturar'. (2) O guard do Fee passa a barrar avançar p/ 'faturar'/'faturado'
--     sem parcelas. (3) Fees legados em 'aprovado' migram p/ 'faturar'. Idempotente.

-- (1) Faturar mídia = marca faturado + gera o lançamento da comissão.
create or replace function lancar_midia(p_user_id uuid, p_midia_id uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not exists (
    select 1 from midias m
    join organization_members om on om.org_id = m.org_id
    where m.id = p_midia_id and om.user_id = p_user_id and om.role in ('owner','admin','manager')
  ) then raise exception 'Acesso negado'; end if;
  update midias set situacao = 'faturado' where id = p_midia_id;
  perform gerar_lancamento_midia(p_midia_id);
end; $$;

grant execute on function lancar_midia(uuid,uuid) to anon, authenticated;

-- (2) Guard do Fee: não avança p/ A Faturar / Faturado sem parcelas (é o que vira o a-receber).
create or replace function set_producao_situacao(p_user_id uuid, p_producao_id uuid, p_situacao text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not exists (
    select 1 from producao p join organization_members om on om.org_id = p.org_id
    where p.id = p_producao_id and om.user_id = p_user_id and om.role in ('owner','admin','manager')
  ) then raise exception 'Acesso negado'; end if;

  if p_situacao in ('faturar','faturado') and exists (
    select 1 from producao where id = p_producao_id and tipo = 'fee'
      and jsonb_array_length(coalesce(detalhe->'parcelas','[]'::jsonb)) = 0
  ) then raise exception 'Gere as parcelas do Fee antes de aprovar (é o que vira o faturamento).'; end if;

  update producao set situacao = p_situacao, updated_at = now() where id = p_producao_id;
  perform gerar_lancamentos_producao(p_producao_id);
end; $$;

grant execute on function set_producao_situacao(uuid,uuid,text) to anon, authenticated;

-- (3) Fees liberados no modelo antigo ('aprovado') passam pro estado unificado 'faturar'.
update producao set situacao = 'faturar', updated_at = now()
where tipo = 'fee' and situacao = 'aprovado';

notify pgrst, 'reload schema';
