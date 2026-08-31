-- 269_fechamento_sem_envio.sql
-- FECHAR SEM ENVIAR (pedido do Rafael, 28/08): sócio e estagiário têm ciclo
-- fechado no Flow, mas não vão no material da contabilidade. Antes, todo run
-- fechado ficava com "Enviar para a contabilidade" pendente para sempre — uma
-- pendência falsa na tela.
--
-- É diferente do `entra_fechamento` da ficha (mig. 256): lá a pessoa nem entra
-- no corte; aqui ela ENTRA, o ciclo dela fecha e vira registro/espelho — só
-- não há e-mail. Enviar depois continua possível (o botão fica discreto).
-- Idempotente.

alter table rh_fechamento_run add column if not exists sem_envio boolean not null default false;

create or replace function rh_fechamento_sem_envio(p_run uuid, p_sem_envio boolean)
returns void language plpgsql security definer set search_path to 'public' as $$
declare v_org uuid; v_status text;
begin
  select org_id, status into v_org, v_status from rh_fechamento_run where id = p_run;
  if v_org is null then raise exception 'Fechamento não encontrado'; end if;
  if not rh_can(v_org) then raise exception 'Acesso negado' using errcode = '42501'; end if;
  -- Já enviado não vira "sem envio": o e-mail existe e o histórico não mente.
  if coalesce(p_sem_envio, false) and v_status = 'enviado' then
    raise exception 'Este ciclo já foi enviado à contabilidade';
  end if;
  update rh_fechamento_run set sem_envio = coalesce(p_sem_envio, false) where id = p_run;
end $$;
revoke execute on function rh_fechamento_sem_envio(uuid, boolean) from public, anon;
grant  execute on function rh_fechamento_sem_envio(uuid, boolean) to authenticated;

notify pgrst, 'reload schema';
