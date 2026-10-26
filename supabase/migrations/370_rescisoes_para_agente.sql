-- 370 — rescisões em andamento, para a Flávia conduzir o DP com a Ocvel (26/10/2026)
--
-- A Flávia tem acesso financeiro, NÃO o do RH (salário e CPF não são dela). Esta
-- função devolve só o que o fluxo de rescisão precisa: quem está em aviso prévio
-- ou foi desligado nos últimos 10 dias, com as datas — sem CPF, salário nem
-- benefícios. Gate = fin_can, como as demais da API de agentes.
create or replace function public.fin_rescisoes(p_org uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public'
as $$
declare v jsonb; v_hoje date := fin_hoje();
begin
  if not fin_can(p_org) then raise exception 'Acesso negado' using errcode = '42501'; end if;
  select coalesce(jsonb_agg(row_to_json(t) order by t.ultimo_dia), '[]'::jsonb) into v from (
    select c.id as colaborador_id, c.nome, c.cargo, c.status,
           c.aviso_previo_modo as aviso_modo, c.aviso_previo_ini::text as aviso_ini, c.aviso_previo_fim::text as aviso_fim,
           c.data_demissao::text as demissao,
           coalesce(c.aviso_previo_fim, c.data_demissao)::text as ultimo_dia,
           case when coalesce(c.aviso_previo_fim, c.data_demissao) is null then null
                when coalesce(c.aviso_previo_fim, c.data_demissao) >= v_hoje
                  then fin_dias_uteis_entre(p_org, v_hoje, coalesce(c.aviso_previo_fim, c.data_demissao))
                else -fin_dias_uteis_entre(p_org, coalesce(c.aviso_previo_fim, c.data_demissao), v_hoje) end as dias_uteis_ate_ultimo
      from rh_colaborador c
     where c.org_id = p_org and not c.arquivado
       and (c.aviso_previo_ini is not null
            or (c.status = 'desligado' and c.data_demissao >= v_hoje - 10))
       -- quem já saiu há mais de 10 dias saiu do fluxo, salvo aviso que ainda não terminou
       and coalesce(c.aviso_previo_fim, c.data_demissao, v_hoje) >= v_hoje - 10
  ) t;
  return v;
end $$;
revoke execute on function public.fin_rescisoes(uuid) from public, anon;
grant execute on function public.fin_rescisoes(uuid) to authenticated;

notify pgrst, 'reload schema';
