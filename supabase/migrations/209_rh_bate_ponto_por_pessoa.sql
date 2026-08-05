-- 209_rh_bate_ponto_por_pessoa.sql
-- "Sócios e cargos de confiança não batem ponto. Estagiários também, mas quero
--  testar eles apontando. Seria importante ter um toggle em cada funcionário,
--  assim sabe de quem cobrar." (Rafael, 05/08)
--
-- Até aqui só existia a trava GLOBAL da org (ponto_obrigatorio, mig. 199) e o
-- gate isentava quem não tem ficha vinculada. Isso não bastava: sócio COM
-- login e ficha era cobrado igual, e o espelho dele acusava falta do mês
-- inteiro — o do Rafael marcava 152h de falta e -151:08 de saldo, apurando
-- ausência de quem nunca teve jornada a cumprir.
--
-- A dispensa não é capricho: cargo de gestão é isento de controle de jornada
-- (art. 62, II da CLT). Estagiário segue a Lei 11.788 — o Rafael quer os dele
-- apontando mesmo assim, por causa das horas por tarefa, e é por isso que o
-- padrão é POR PESSOA e não por tipo de vínculo.
--
-- Quem não bate ponto continua podendo ter registros (o Rafael tem): o que
-- muda é que o dia dele deixa de ter carga esperada. Sem carga esperada não
-- existe falta — e as horas que ele bater aparecem como estão, sem virar
-- "extra" contra uma jornada que não é dele.
--
-- Nasce true para todo mundo (o estado de hoje), menos sócio — que é o caso
-- que já estava errado na tela.
--
-- Idempotente.

alter table rh_colaborador add column if not exists bate_ponto boolean not null default true;

comment on column rh_colaborador.bate_ponto is
  'Se a pessoa tem jornada controlada. false = sócio/cargo de confiança (art. 62 II CLT): sem carga esperada, sem falta, fora da cobrança.';

-- Sócio já nasce dispensado: é o estado real e o que a tela mostrava errado.
update rh_colaborador set bate_ponto = false
 where tipo_vinculo = 'socio' and bate_ponto is distinct from false;

-- ── O gate não trava quem não bate ponto ───────────────────────────────────
create or replace function rh_ponto_gate()
returns jsonb language plpgsql stable security definer set search_path to 'public' as $$
declare
  v_uid uuid; v_colab uuid; v_org uuid; v_hoje date;
  v_obrig boolean; v_dias int[]; v_n int; v_abona boolean; v_bate boolean;
begin
  v_uid := auth.uid();
  if v_uid is null then return jsonb_build_object('exige', false); end if;

  select id, org_id, bate_ponto into v_colab, v_org, v_bate
    from rh_colaborador
   where membro_user_id = v_uid and status = 'ativo' and coalesce(arquivado, false) = false
   limit 1;
  if v_colab is null then return jsonb_build_object('exige', false); end if;
  -- Dispensado de marcar jornada: a parede nunca aparece para ele.
  if not coalesce(v_bate, true) then
    return jsonb_build_object('exige', false, 'colaborador_id', v_colab);
  end if;

  select coalesce(ponto_obrigatorio, false) into v_obrig from org_settings where org_id = v_org;
  if not coalesce(v_obrig, false) then
    return jsonb_build_object('exige', false, 'colaborador_id', v_colab);
  end if;

  v_hoje := (now() at time zone 'America/Sao_Paulo')::date;

  select coalesce(
    (select j.dias_semana from rh_jornada j where j.colaborador_id = v_colab limit 1),
    (select j.dias_semana from rh_jornada j where j.org_id = v_org and j.colaborador_id is null limit 1),
    array[1,2,3,4,5]) into v_dias;
  if not (extract(isodow from v_hoje)::int = any (v_dias)) then
    return jsonb_build_object('exige', false, 'colaborador_id', v_colab);
  end if;

  select abona into v_abona from rh_feriado where org_id = v_org and data = v_hoje;
  if found and coalesce(v_abona, true) then
    return jsonb_build_object('exige', false, 'colaborador_id', v_colab);
  end if;
  -- Emenda de feriado a que a pessoa aderiu (mig. 205) também não prende.
  if rh_ponte_abona(v_colab, v_hoje) then
    return jsonb_build_object('exige', false, 'colaborador_id', v_colab);
  end if;

  select count(*) into v_n from rh_ponto p
   where p.colaborador_id = v_colab and p.data = v_hoje and p.entrada is not null;

  return jsonb_build_object('exige', v_n = 0, 'colaborador_id', v_colab);
end $$;
revoke execute on function rh_ponto_gate() from public, anon;
grant  execute on function rh_ponto_gate() to authenticated;

-- ── Toggle ─────────────────────────────────────────────────────────────────
create or replace function rh_set_bate_ponto(p_colaborador uuid, p_bate boolean)
returns void language plpgsql security definer set search_path to 'public' as $$
declare v_org uuid;
begin
  select org_id into v_org from rh_colaborador where id = p_colaborador;
  if v_org is null then raise exception 'Colaborador não encontrado'; end if;
  if not rh_can(v_org) then raise exception 'Acesso negado' using errcode = '42501'; end if;
  update rh_colaborador set bate_ponto = coalesce(p_bate, true) where id = p_colaborador;
end $$;
revoke execute on function rh_set_bate_ponto(uuid, boolean) from public, anon;
grant  execute on function rh_set_bate_ponto(uuid, boolean) to authenticated;

notify pgrst, 'reload schema';
