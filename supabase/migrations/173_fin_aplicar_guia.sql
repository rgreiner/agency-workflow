-- 173_fin_aplicar_guia.sql
-- Importar guia (Darf/FGTS/DAS/GPS/parcelamento) no Financeiro: a guia oficial
-- atualiza o lançamento EM ABERTO correspondente (valor real, vencimento,
-- competência) e fica anexada como documento. Vale para qualquer origem —
-- inclusive os adotados pela folha (mig. 172): a guia é a verdade final.
-- Pago nunca muda (a RPC recusa). Criar lançamento novo continua no
-- create_lancamento de sempre (com a guia em p_data->anexos). Idempotente.

create or replace function fin_aplicar_guia(
  p_org_id uuid, p_lancamento_id uuid,
  p_valor numeric, p_venc date, p_competencia date, p_anexo jsonb
) returns void language plpgsql security definer set search_path to 'public' as $$
begin
  if not exists (
    select 1 from organization_members
    where org_id = p_org_id and user_id = auth.uid() and role in ('owner','admin','manager')
  ) then raise exception 'Acesso negado' using errcode = '42501'; end if;

  update lancamentos set
    valor       = coalesce(p_valor, valor),
    vencimento  = coalesce(p_venc, vencimento),
    competencia = coalesce(p_competencia, competencia),
    anexos      = case when p_anexo is null then anexos
                       else coalesce(anexos, '[]'::jsonb) || jsonb_build_array(p_anexo) end,
    updated_at  = now()
  where id = p_lancamento_id and org_id = p_org_id and situacao = 'em_aberto';

  if not found then
    raise exception 'Lançamento não está em aberto — guia não aplicada';
  end if;
end; $$;

revoke execute on function fin_aplicar_guia(uuid, uuid, numeric, date, date, jsonb) from public;
grant execute on function fin_aplicar_guia(uuid, uuid, numeric, date, date, jsonb) to authenticated;

notify pgrst, 'reload schema';
