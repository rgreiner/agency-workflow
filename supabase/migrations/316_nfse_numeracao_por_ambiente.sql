-- ── NFS-e: a numeração da DPS é POR AMBIENTE ────────────────────────────────
--
-- 01/10/2026. O contador era um só para os dois ambientes, e isso quebra de duas
-- formas — a primeira já estava armada para o próximo clique:
--
-- 1. O Id da DPS inclui série + número. A nota de teste de 30/09 usou nDPS 1 em
--    produção restrita, mas foi emitida por script e não mexeu no contador, que
--    seguiu em 1. A primeira emissão pela tela ia remontar o MESMO Id e levar
--    recusa por duplicidade — com uma mensagem que não diz nada sobre contador.
--
-- 2. Mesmo corrigido o ponto 1, cada nota de TESTE queimaria um número da
--    sequência de PRODUÇÃO. Buraco em sequência fiscal é coisa que a Receita
--    pede para explicar, e "era teste" não é explicação que se dê dois anos
--    depois.
--
-- Com um contador por ambiente, produção fica com 1, 2, 3… limpo, e o teste
-- gasta à vontade o que é dele.

alter table org_nfse_config
  add column if not exists proximo_numero_restrita bigint not null default 1;

-- A restrita já gastou o número 1 (chave ...126090884913152, emitida em 30/09).
update org_nfse_config
   set proximo_numero_restrita = greatest(proximo_numero_restrita, 2)
 where exists (select 1 from nota_fiscal n where n.org_id = org_nfse_config.org_id and n.ambiente = 'restrita')
    or proximo_numero_restrita = 1;

comment on column org_nfse_config.proximo_numero      is 'Próximo nDPS em PRODUÇÃO. Sequência oficial — não pode ter buraco.';
comment on column org_nfse_config.proximo_numero_restrita is 'Próximo nDPS em produção restrita. Separado para que teste não gaste número oficial.';

-- PostgREST é estrito com overload: parâmetro novo exige DROP + CREATE.
drop function if exists proximo_numero_nfse(uuid, uuid);

create or replace function proximo_numero_nfse(p_user_id uuid, p_org_id uuid, p_ambiente text)
returns bigint
language plpgsql
security definer
set search_path to 'public'
as $$
declare v_num bigint;
begin
  if p_user_id is distinct from auth.uid() then
    raise exception 'Acesso negado' using errcode = '42501';
  end if;
  if not fin_can(p_org_id) then raise exception 'Acesso negado' using errcode = '42501'; end if;
  if p_ambiente not in ('restrita', 'producao') then
    raise exception 'Ambiente inválido: %', p_ambiente using errcode = '22023';
  end if;

  if p_ambiente = 'producao' then
    update org_nfse_config set proximo_numero = proximo_numero + 1, updated_at = now()
     where org_id = p_org_id
     returning proximo_numero - 1 into v_num;
  else
    update org_nfse_config set proximo_numero_restrita = proximo_numero_restrita + 1, updated_at = now()
     where org_id = p_org_id
     returning proximo_numero_restrita - 1 into v_num;
  end if;

  if v_num is null then raise exception 'Configure a nota fiscal antes de emitir.'; end if;
  return v_num;
end; $$;

-- ⚠️ ALTER DEFAULT PRIVILEGES dá EXECUTE a anon e authenticated em TODA função
-- nova deste banco: revogar de PUBLIC não fecha nada. Esta precisa ser chamável
-- por usuário logado (authenticated), então o que se fecha aqui é o anônimo.
revoke execute on function proximo_numero_nfse(uuid, uuid, text) from public, anon;
grant execute on function proximo_numero_nfse(uuid, uuid, text) to authenticated;

notify pgrst, 'reload schema';
