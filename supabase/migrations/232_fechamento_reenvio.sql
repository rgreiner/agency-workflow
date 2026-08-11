-- 232_fechamento_reenvio.sql
-- Reenvio do fechamento. O mês fechava de vez no primeiro envio: `enviarFechamento`
-- recusa competência já enviada, o que é a trava certa contra disparo em dobro —
-- mas quando a contabilidade DEVOLVE o pacote pedindo correção (foi o caso de
-- julho/2026: rendimento fora da base e nº da NF em toda linha), não havia caminho
-- de volta pela tela.
--
-- Agora o reenvio é explícito e fica registrado: `envios` conta quantas vezes o mês
-- saiu, e `enviado_em` passa a ser "o último envio" — sem isso o segundo disparo
-- apagaria a data do primeiro e o histórico contaria uma versão só.
-- Idempotente.

alter table fechamento_contabil add column if not exists envios integer not null default 0;

-- Retroativo: quem já está 'enviado' saiu ao menos uma vez.
update fechamento_contabil set envios = 1 where status = 'enviado' and envios = 0;

-- Mesma assinatura de sempre (129) — só o corpo muda. Copiada de
-- pg_get_function_arguments pra não esbarrar no "create or replace não remove
-- default de parâmetro".
create or replace function marcar_fechamento_enviado(
  p_org_id uuid, p_competencia text, p_user_id uuid,
  p_destinatarios text[] default null, p_erro text default null
) returns void language plpgsql security definer set search_path = public as $$
begin
  if not exists (
    select 1 from organization_members om
    where om.org_id = p_org_id and om.user_id = p_user_id
      and (om.can_finance or om.role in ('owner','admin'))
  ) then raise exception 'Acesso negado'; end if;

  if p_erro is not null then
    update fechamento_contabil
       set status = 'erro', erro = p_erro
     where org_id = p_org_id and competencia = p_competencia;
  else
    update fechamento_contabil
       set status = 'enviado', erro = null,
           confirmado_por = p_user_id, confirmado_em = now(), enviado_em = now(),
           destinatarios = p_destinatarios,
           envios = envios + 1
     where org_id = p_org_id and competencia = p_competencia;
  end if;
end $$;

grant execute on function marcar_fechamento_enviado(uuid, text, uuid, text[], text) to anon, authenticated;

notify pgrst, 'reload schema';
