-- 242_midia_rotina_pasta_por_cliente.sql
-- Onde cada rotina grava, NAQUELE cliente. O catálogo tem o nome canônico
-- ("Boletos Digitais"), mas o drive tem quatro grafias reais do mesmo lugar
-- ("Boletos digitais", "Boletos Digitais Mensais", "Boletos digitais mensais")
-- e casos que nenhuma heurística resolve com honestidade — "Relatórios Mensais"
-- × "Relatório mensal de mídia e produção" (Ópera) e "Relatório mensais de
-- mídia e produção" (KSBIG).
--
-- Medido em 14/08 contra o drive real: o casamento automático acerta 17 de 21
-- pastas; nos 4 restantes ele CRIARIA uma quinta grafia ao lado da existente —
-- exatamente a deriva que o Hub deveria matar.
--
-- Por isso a decisão fica gravada: na primeira vez o Flow resolve (ou pergunta),
-- e daí em diante usa o ID. Heurística vira decisão registrada.
-- Idempotente.

alter table midia_cliente_rotina add column if not exists pasta_folder_id text;

create or replace function midia_rotina_pasta(p_vinculo uuid, p_folder_id text)
returns void language plpgsql security definer set search_path = public as $$
declare v_org uuid;
begin
  select org_id into v_org from midia_cliente_rotina where id = p_vinculo;
  if v_org is null then raise exception 'Rotina do cliente não encontrada'; end if;
  if not midia_can(v_org) then raise exception 'Acesso negado' using errcode = '42501'; end if;
  update midia_cliente_rotina
     set pasta_folder_id = nullif(btrim(coalesce(p_folder_id, '')), '')
   where id = p_vinculo;
end $$;
revoke execute on function midia_rotina_pasta(uuid, text) from public, anon;
grant  execute on function midia_rotina_pasta(uuid, text) to authenticated;

notify pgrst, 'reload schema';
