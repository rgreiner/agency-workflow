-- 207_rh_justificativa_anexo.sql
-- "Na hora de justificar, às vezes precisamos subir um arquivo." (Rafael, 05/08)
--
-- O campo já existia (rh_justificativa.doc_id, mig. 150) e nunca foi ligado: a
-- tela dizia "envie o PDF depois na sua ficha (o RH anexa à justificativa)",
-- ou seja, o atestado circulava por fora do sistema.
--
-- O que faltava era permissão. `rh_documento` é ALL/rh_can — quem justifica é
-- o COLABORADOR, que não tem rh_can. Duas escolhas para não abrir demais:
--
--  · o insert NÃO vira policy nova: passa por uma RPC security definer que só
--    cria documento do tipo 'atestado' e só para a própria ficha. Abrir INSERT
--    em rh_documento deixaria o colaborador gravar qualquer tipo (holerite,
--    rescisão) na ficha dele.
--  · a leitura ganha uma policy estreita: o colaborador enxerga um documento
--    apenas enquanto ele estiver amarrado a uma justificativa DELE. Não é "ver
--    a própria pasta" — holerite e ASO seguem invisíveis para ele.
--
-- Idempotente.

drop policy if exists rh_documento_self_anexo on rh_documento;
-- SELECT estreito: só o que o próprio anexou a uma justificativa sua.
create policy rh_documento_self_anexo on rh_documento for select
  using (
    rh_is_self(colaborador_id)
    and exists (select 1 from rh_justificativa j
                 where j.doc_id = rh_documento.id and j.colaborador_id = rh_documento.colaborador_id)
  );

-- ── Cria o documento do anexo e devolve o id ────────────────────────────────
-- Chamada pela rota de upload depois de gravar o arquivo no volume privado.
-- O caller pode ser o próprio colaborador (justificando) ou o RH (anexando por
-- ele). A chave TEM que estar no prefixo privado: é o que impede o arquivo de
-- ser servido pela rota pública /uploads.
create or replace function rh_justificativa_anexo(
  p_colaborador uuid, p_nome text, p_chave text, p_competencia date default null
) returns uuid language plpgsql security definer set search_path to 'public' as $$
declare v_org uuid; v_id uuid;
begin
  select org_id into v_org from rh_colaborador where id = p_colaborador;
  if v_org is null then raise exception 'Colaborador não encontrado'; end if;
  if not (rh_can(v_org) or rh_is_self(p_colaborador)) then
    raise exception 'Acesso negado' using errcode = '42501';
  end if;
  if coalesce(btrim(p_chave), '') = '' or p_chave not like 'rh-privado/%' or p_chave like '%..%' then
    raise exception 'Chave de arquivo inválida';
  end if;

  insert into rh_documento (org_id, colaborador_id, tipo, nome, chave, competencia, created_by)
  values (v_org, p_colaborador, 'atestado', nullif(btrim(coalesce(p_nome, '')), ''), p_chave,
          p_competencia, auth.uid())
  returning id into v_id;
  return v_id;
end $$;
revoke execute on function rh_justificativa_anexo(uuid, text, text, date) from public, anon;
grant  execute on function rh_justificativa_anexo(uuid, text, text, date) to authenticated;

notify pgrst, 'reload schema';
