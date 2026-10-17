-- A tela "Meu ponto" precisa saber se o intervalo mínimo de 1h vale para a
-- pessoa (mig. 352) para mostrar "retorno liberado às HH:MM" em vez de deixar
-- clicar e recusar. Quem não é RH não lê rh_jornada; esta função responde só
-- o booleano, para a própria pessoa ou para o RH.
create or replace function rh_intervalo_obrigatorio(p_colaborador_id uuid)
returns boolean
language plpgsql stable security definer set search_path = public as $$
declare v_org uuid; v boolean;
begin
  select org_id into v_org from rh_colaborador where id = p_colaborador_id;
  if v_org is null then return false; end if;
  if not (rh_is_self(p_colaborador_id) or rh_can(v_org)) then raise exception 'Acesso negado' using errcode = '42501'; end if;
  select extract(epoch from (j.saida - j.entrada) - (j.intervalo_fim - j.intervalo_ini)) / 60 > 360 into v
    from rh_jornada j
   where (j.colaborador_id = p_colaborador_id or j.colaborador_id is null) and j.org_id = v_org
     and j.vigencia_ini <= (now() at time zone 'America/Sao_Paulo')::date
   order by (j.colaborador_id is null), j.vigencia_ini desc
   limit 1;
  return coalesce(v, true);
end $$;
revoke execute on function rh_intervalo_obrigatorio(uuid) from public, anon;
grant execute on function rh_intervalo_obrigatorio(uuid) to authenticated;
notify pgrst, 'reload schema';
