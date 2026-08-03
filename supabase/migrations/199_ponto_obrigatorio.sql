-- 199_ponto_obrigatorio.sql
-- Pedido do Rafael (03/08): "a partir de quando virarmos, pode colocar um toggle
-- no RH do ponto, para travar utilização do flow sem bater ponto".
--
-- Nasce DESLIGADO. É para ser ligado no dia em que o time sair do Pontomais de
-- vez — hoje são 5 de 10 batendo, e ligar antes disso trancaria meia equipe.
--
-- Função nova em vez de estender `rh_ponto_estado`: aquela alimenta o lembrete
-- do canto, que já funciona. Uma trava que bloqueia a tela inteira não deve
-- compartilhar caminho com um card que alguém pode dispensar.
--
-- A trava nunca é uma parede sem porta: a própria tela de bloqueio bate o ponto.
-- E ela só vale em dia de jornada — feriado que abona e dia fora da escala não
-- prendem ninguém.
--
-- Idempotente.

alter table org_settings add column if not exists ponto_obrigatorio boolean not null default false;

create or replace function rh_ponto_gate()
returns jsonb language plpgsql stable security definer set search_path to 'public' as $$
declare
  v_uid uuid; v_colab uuid; v_org uuid; v_hoje date;
  v_obrig boolean; v_dias int[]; v_n int; v_abona boolean;
begin
  v_uid := auth.uid();
  if v_uid is null then return jsonb_build_object('exige', false); end if;

  -- Sem ficha vinculada não há ponto a bater: sócio sem ficha, convidado,
  -- terceiro. Travar essa gente seria trancar quem não tem a chave.
  select id, org_id into v_colab, v_org
    from rh_colaborador
   where membro_user_id = v_uid and status = 'ativo' and coalesce(arquivado, false) = false
   limit 1;
  if v_colab is null then return jsonb_build_object('exige', false); end if;

  select coalesce(ponto_obrigatorio, false) into v_obrig from org_settings where org_id = v_org;
  if not coalesce(v_obrig, false) then
    return jsonb_build_object('exige', false, 'colaborador_id', v_colab);
  end if;

  v_hoje := (now() at time zone 'America/Sao_Paulo')::date;

  select coalesce(
    (select j.dias_semana from rh_jornada j where j.colaborador_id = v_colab limit 1),
    (select j.dias_semana from rh_jornada j where j.org_id = v_org and j.colaborador_id is null limit 1),
    '{1,2,3,4,5}'::int[]) into v_dias;

  select fe.abona into v_abona from rh_feriado fe where fe.org_id = v_org and fe.data = v_hoje;

  -- Fora da escala ou feriado que abona: não há jornada esperada, não trava.
  if not (extract(isodow from v_hoje)::int = any (v_dias)) or coalesce(v_abona, false) then
    return jsonb_build_object('exige', false, 'colaborador_id', v_colab, 'dia', v_hoje);
  end if;

  select count(*) into v_n
    from rh_ponto p join rh_marcacao m on m.ponto_id = p.id
   where p.colaborador_id = v_colab and p.data = v_hoje;

  return jsonb_build_object(
    'exige', v_n = 0,
    'colaborador_id', v_colab,
    'dia', v_hoje
  );
end $$;

create or replace function rh_set_ponto_obrigatorio(p_org uuid, p_ativo boolean)
returns void language plpgsql security definer set search_path to 'public' as $$
begin
  if not rh_can(p_org) then raise exception 'Acesso negado' using errcode = '42501'; end if;
  insert into org_settings (org_id, ponto_obrigatorio) values (p_org, coalesce(p_ativo, false))
  on conflict (org_id) do update set ponto_obrigatorio = coalesce(p_ativo, false);
end $$;

revoke execute on function rh_ponto_gate()                      from public, anon;
revoke execute on function rh_set_ponto_obrigatorio(uuid, boolean) from public, anon;
grant  execute on function rh_ponto_gate()                      to authenticated;
grant  execute on function rh_set_ponto_obrigatorio(uuid, boolean) to authenticated;

notify pgrst, 'reload schema';
