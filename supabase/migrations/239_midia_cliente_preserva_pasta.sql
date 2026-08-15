-- 239_midia_cliente_preserva_pasta.sql
-- Bug latente que eu mesmo criei na 234: `midia_atualizar_cliente` sobrescreve
-- `drive_folder_id` com NULL toda vez, porque o formulário de "Links da
-- operação" edita só plano/specs/CRM/observação e manda o resto vazio.
--
-- Hoje é inofensivo (o campo nasce vazio e nada o preenche), mas ele existe
-- para a fase de pastas: no dia em que o Flow gravar a pasta do cliente no
-- drive Mídia, o primeiro "Salvar links" apagaria o vínculo — e o sintoma
-- apareceria longe da causa.
--
-- Regra: parâmetro NULL = "não mexi neste campo"; string vazia continua
-- limpando (é o que a UI manda quando a pessoa apaga o conteúdo).
-- Idempotente.

create or replace function midia_atualizar_cliente(
  p_id uuid, p_plano_url text, p_specs_url text, p_crm_url text,
  p_drive_folder_id text, p_observacao text
) returns void language plpgsql security definer set search_path = public as $$
declare v_org uuid;
begin
  select org_id into v_org from midia_cliente where id = p_id;
  if v_org is null then raise exception 'Operação não encontrada'; end if;
  if not midia_can(v_org) then raise exception 'Acesso negado' using errcode = '42501'; end if;
  update midia_cliente
     set plano_url = case when p_plano_url is null then plano_url
                          else nullif(btrim(p_plano_url), '') end,
         specs_url = case when p_specs_url is null then specs_url
                          else nullif(btrim(p_specs_url), '') end,
         crm_url   = case when p_crm_url is null then crm_url
                          else nullif(btrim(p_crm_url), '') end,
         drive_folder_id = case when p_drive_folder_id is null then drive_folder_id
                                else nullif(btrim(p_drive_folder_id), '') end,
         observacao = case when p_observacao is null then observacao
                           else nullif(btrim(p_observacao), '') end
   where id = p_id;
end $$;

notify pgrst, 'reload schema';
