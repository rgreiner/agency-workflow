-- 219_faturar_sem_comissao.sql
-- "Quando temos um item a faturar com zero reais para a agência, damos como
--  faturado e não lançamos venda no financeiro, apenas para entrar nestes
--  relatórios — é o caso de Comil e Opera. Hoje o financeiro não consegue
--  faturar ele mesmo zerado, dá erro." (Rafael, 05/08)
--
-- A trava da 186 está certa e fica: faturar com comissão zerada por engano tira
-- o documento da fila e não gera nada no caixa — some calado. O que faltava era
-- a SAÍDA para o caso legítimo, em que a agência de fato não ganha comissão e o
-- documento precisa existir só para constar no Relatório de Autorização (o
-- cliente paga o veículo direto).
--
-- Então a trava deixa de ser parede e vira pergunta: por padrão barra, e o
-- financeiro confirma explicitamente com `p_sem_comissao`. Nesse caminho o
-- documento é marcado como faturado e NENHUM lançamento é gerado — que é
-- exatamente a intenção, agora declarada em vez de acidental.
--
-- A assinatura antiga é DROPADA antes: o PostgREST self-hosted não resolve
-- overload, e deixar as duas quebraria a chamada com "could not choose the best
-- candidate function".
--
-- Idempotente.

drop function if exists lancar_midia(uuid, uuid, uuid, text, text, text);

create or replace function lancar_midia(
  p_user_id uuid, p_midia_id uuid, p_conta_id uuid default null,
  p_categoria text default null, p_centro_custo text default null, p_forma text default null,
  p_sem_comissao boolean default false
) returns void language plpgsql security definer set search_path to 'public' as $$
declare m record; v_doc text; v_comissao numeric(14,2); v_prod numeric(14,2);
begin
  if p_user_id is distinct from auth.uid() then
    raise exception 'Acesso negado' using errcode = '42501';
  end if;
  if not exists (
    select 1 from midias mi
    join organization_members om on om.org_id = mi.org_id
    where mi.id = p_midia_id and om.user_id = p_user_id
      and om.role in ('owner','admin','manager') and om.arquivado = false
  ) then raise exception 'Acesso negado'; end if;

  select * into m from midias where id = p_midia_id;
  if not found then raise exception 'Mídia não encontrada'; end if;
  v_doc := coalesce(nullif(concat_ws(' ', m.serie, m.numero), ''), m.titulo, 'esta mídia');

  if m.veiculo_id is null then
    raise exception 'Não dá para faturar % sem veículo: a comissão é cobrada do veículo ou do cliente por conta dele, e sem isso o lançamento não nasce. Informe o veículo na mídia primeiro.', v_doc
      using errcode = '23502';
  end if;

  v_comissao := round(coalesce(m.valor,0) * coalesce(m.desconto_pct,0) / 100.0, 2);
  v_prod := round(
    round(_br_num(m.detalhe->>'producao_valor')
      * greatest(coalesce(nullif(_br_num(m.detalhe->>'producao_quantidade'), 0), 1), 1), 2)
    * _br_num(m.detalhe->>'producao_comissao_pct') / 100.0, 2);

  if coalesce(v_comissao,0) + coalesce(v_prod,0) <= 0 then
    -- Sem a confirmação, continua barrando: o erro por digitação é bem mais
    -- comum que a veiculação sem comissão, e ele é silencioso.
    if not coalesce(p_sem_comissao, false) then
      raise exception 'A comissão de % está zerada: valor do documento %, desconto % por cento. Se a agência realmente não ganha comissão neste documento, use "Faturar sem comissão" — ele entra no Relatório de Autorização e nenhum lançamento é gerado.',
        v_doc, coalesce(m.valor,0), coalesce(m.desconto_pct,0)
        using errcode = '23514';
    end if;
    -- Caminho declarado: entra no relatório, não entra no caixa.
    update midias set situacao = 'faturado', updated_at = now() where id = p_midia_id;
    return;
  end if;

  -- Com comissão, `p_sem_comissao` é ignorado de propósito: existe dinheiro a
  -- receber, e deixar de lançá-lo seria perder receita sem registro.
  update midias set situacao = 'faturado', updated_at = now() where id = p_midia_id;
  perform gerar_lancamento_midia(p_midia_id, p_conta_id, p_categoria, p_centro_custo, p_forma);
end; $$;

revoke execute on function lancar_midia(uuid, uuid, uuid, text, text, text, boolean) from public, anon;
grant  execute on function lancar_midia(uuid, uuid, uuid, text, text, text, boolean) to authenticated;

notify pgrst, 'reload schema';
