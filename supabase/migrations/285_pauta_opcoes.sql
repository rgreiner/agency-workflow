-- 285_pauta_opcoes.sql
-- Veículo e Formato do título da pauta saem do array chumbado no front
-- (src/lib/atividade-titulo.ts) e viram CADASTRO por organização, editável em
-- Configurações → Pauta (owner/admin). Entra um terceiro campo: OBJETIVO.
--
-- O que motivou (levantamento de 13/09/2026 sobre as 399 tarefas em produção):
--   • Só 104 (26%) seguiam o padrão completo. 158 tinham 2 segmentos e 137 eram
--     título livre. A lista servia a uma minoria.
--   • 80% dos formatos preenchidos eram DIGITADOS, não escolhidos — a lista
--     atendia 1 em cada 5 usos.
--   • 9 dos 13 veículos e 7 dos 12 formatos NUNCA foram usados.
--   • O campo Formato virava gaveta de três coisas: formato de verdade, nome de
--     cliente (~20 usos) e OBJETIVO DE MÍDIA — conversão (19), captação (15) e
--     remarketing (9), todos concentrados nos últimos 90 dias. Daí o campo novo:
--     sem ele, o objetivo continua se disfarçando de formato.
--
-- O que estes campos SÃO: sugestão para compor `activities.title`
-- ("AAMMDD - Veículo - Formato - Objetivo - Título da demanda"). NÃO viram coluna
-- de activities — o título segue sendo a fonte de verdade. Por isso o valor
-- cadastrado é o TEXTO que entra no título, sem slug.
--
-- Renomear uma opção NÃO reescreve o histórico: título é string congelada, e
-- mexer nele mudaria nome de pasta no Drive e quebraria busca salva.
--
-- A semente é CURADA, não parseada. O parsing do histórico foi usado para
-- decidir (cada item abaixo tem o número que o justifica), mas semear direto do
-- parsing traria nome de cliente e objetivo como se fossem formato — exatamente
-- a bagunça que esta migration existe para desfazer. O que ficou de fora não se
-- perde: `org_pauta_uso()` mostra na tela o que está sendo digitado fora do
-- cadastro, para promover com um clique.
--
-- Régua de grant deste projeto: revogar de public, anon E authenticated (o banco
-- tem default privileges para os dois últimos) e devolver o grant só a quem o app
-- chama. Conferir depois de aplicar com has_function_privilege — nunca confiar no
-- que a migration diz que fez.
--
-- Idempotente.

create table if not exists org_pauta_opcao (
  id         uuid primary key default gen_random_uuid(),
  org_id     uuid not null references organizations(id) on delete cascade,
  campo      text not null check (campo in ('veiculo', 'formato', 'objetivo')),
  valor      text not null,          -- o texto que entra no título, como aparece
  ordem      int  not null default 999,
  created_at timestamptz not null default now()
);
-- lower(): "Spotify" e "spotify" são a mesma opção.
create unique index if not exists org_pauta_opcao_uk
  on org_pauta_opcao (org_id, campo, lower(valor));
create index if not exists org_pauta_opcao_org_idx
  on org_pauta_opcao (org_id, campo, ordem);

alter table org_pauta_opcao enable row level security;
drop policy if exists org_pauta_opcao_read on org_pauta_opcao;
create policy org_pauta_opcao_read on org_pauta_opcao
  for select using (is_org_member(org_id));
-- Escrita só pelas RPCs (owner/admin).

-- ── Semente ──────────────────────────────────────────────────────────────────
-- Ordem = frequência observada, então o mais usado nasce no topo do Select.
insert into org_pauta_opcao (org_id, campo, valor, ordem)
select o.id, x.campo, x.valor, x.ordem
  from organizations o
 cross join (values
   -- VEÍCULO. Entra quem tem uso real; sai quem zerou.
   ('veiculo',  'Meta',              10),  -- 38 usos. Cobre Facebook e Instagram:
                                           -- a equipe fala "Meta" e os formatos se
                                           -- repetem nas duas redes.
   ('veiculo',  'Site',              20),  -- 14 usos
   ('veiculo',  'Google',            30),  -- 5 usos digitados como "google".
                                           -- A lista tinha "Google Ads": 0 usos.
   ('veiculo',  'YouTube',           40),  -- 2 usos
   ('veiculo',  'WhatsApp',          50),  -- 1 uso
   ('veiculo',  'Outdoor',           60),  -- fora do padrão ("260831 - Outdoor - …")
   ('veiculo',  'Impresso',          70),  -- fora do padrão ("Anúncio Página Dupla
                                           -- - Revista Dife")
   -- Ficaram de fora por 0 uso: E-mail, Facebook, Instagram, LinkedIn, Rádio,
   -- TikTok, TV. Voltam num clique se a operação mudar.

   -- FORMATO. Entra quem tem uso no campo OU evidência nas palavras do título.
   ('formato',  'Carrossel',         10),  -- 9 no campo + 16 no título
   ('formato',  'Post',              20),  -- 2 no campo + 11 no título
   ('formato',  'Vídeo',             30),  -- 5
   ('formato',  'Reels',             40),  -- 4
   ('formato',  'Card',              50),  -- 4 no título
   ('formato',  'Motion',            60),  -- 3 no título
   ('formato',  'Arte estática',     70),  -- "estáticos" 3 no título (0 no campo:
                                           -- o rótulo é que não era achado)
   ('formato',  'Identidade Visual', 80),  -- "rebranding" 3 no título
   ('formato',  'Stories',           90),  -- 1
   ('formato',  'Apresentação',     100),  -- 1 (digitado no slot do veículo)
   ('formato',  'Página dupla',     110),  -- 1
   ('formato',  'Placa',            120),  -- 1
   ('formato',  'PDF',              130),  -- 1
   -- Ficaram de fora por zero evidência: Banner, GIF, Roteiro, Texto.

   -- OBJETIVO. Campo novo: estava se disfarçando de formato.
   ('objetivo', 'Conversão',         10),  -- 19, todos nos últimos 90 dias
   ('objetivo', 'Captação',          20),  -- 15, idem
   ('objetivo', 'Remarketing',       30),  -- 9,  idem
   ('objetivo', 'Search',            40)   -- 8 no título
 ) as x(campo, valor, ordem)
on conflict do nothing;

-- ── Segmentos do título, para medir uso ──────────────────────────────────────
-- Devolve a parte ESTRUTURADA de cada título: tudo menos o prefixo de data e
-- menos o último segmento (que é o título livre da demanda). Independe de quantos
-- campos o título tem — serve tanto para o layout antigo de 4 partes quanto para
-- o novo de 5.
create or replace function pauta_segmentos()
returns table (org_id uuid, seg text, created_at timestamptz)
language sql stable security definer set search_path to 'public' as $$
  with parsed as (
    select w.org_id, a.created_at,
           case when btrim(split_part(a.title, ' - ', 1)) ~ '^\d{6}$'
                then (string_to_array(a.title, ' - '))[2:]
                else  string_to_array(a.title, ' - ') end as s
      from activities a
      join campaigns  c on c.id = a.campaign_id
      join workspaces w on w.id = c.workspace_id
  )
  select p.org_id, btrim(x.seg), p.created_at
    from parsed p, unnest(p.s[1:cardinality(p.s) - 1]) as x(seg)
   where cardinality(p.s) >= 2
     and btrim(x.seg) <> ''
     and length(btrim(x.seg)) <= 60;
$$;
-- Helper INTERNO: SECURITY DEFINER, devolve os títulos de TODAS as orgs, sem
-- filtro e sem guarda de permissão (a guarda está em quem chama). Não pode
-- existir para o PostgREST.
--
-- Revogar dos TRÊS papéis, não só de public: este banco tem ALTER DEFAULT
-- PRIVILEGES dando execute a `anon` e `authenticated` em toda função nova do
-- schema public (a 167 e a 183 já registraram isso). `revoke from public` tira
-- só o grant de PUBLIC e deixa os dois papéis com acesso — medido em produção,
-- esta função ficou chamável por ANON via POST /rest/v1/rpc/pauta_segmentos.
--
-- Quem a chama é org_pauta_uso(), também SECURITY DEFINER: roda como dono, então
-- não depende de grant nenhum, e filtra por org_id com is_org_member() antes de
-- devolver linha.
revoke execute on function pauta_segmentos() from public, anon, authenticated;

-- Alimenta a tela do admin com as duas metades da mesma pergunta:
--   • opção do cadastro e quanto ela é usada (usos = 0 → candidata a sair);
--   • valor digitado que ainda NÃO é opção (no_cadastro), com contagem — é o
--     "o que a equipe está pedindo e a lista não tem".
-- A sugestão exige 2+ ocorrências: título livre com muitos hifens gera segmento
-- que não é campo nenhum, e 1 ocorrência é quase sempre isso.
create or replace function org_pauta_uso(p_org uuid)
returns table (campo text, valor text, usos bigint, ultimo date, no_cadastro boolean)
language sql stable security definer set search_path to 'public' as $$
  with seg as (
    select lower(s.seg) as chave, s.seg, s.created_at
      from pauta_segmentos() s
     where s.org_id = p_org
  ),
  cad as (
    select o.campo, o.valor, o.ordem, lower(o.valor) as chave
      from org_pauta_opcao o where o.org_id = p_org
  ),
  do_cadastro as (
    select c.campo, c.valor,
           count(s.chave)                              as usos,
           max(s.created_at)::date                     as ultimo,
           false                                       as no_cadastro,
           c.ordem                                     as ordem
      from cad c left join seg s on s.chave = c.chave
     group by c.campo, c.valor, c.ordem
  ),
  sugestao as (
    select null::text                                          as campo,
           (array_agg(s.seg order by s.created_at desc))[1]     as valor,
           count(*)                                            as usos,
           max(s.created_at)::date                             as ultimo,
           true                                                as no_cadastro,
           0                                                   as ordem
      from seg s
     where not exists (select 1 from cad c where c.chave = s.chave)
     group by s.chave
    having count(*) >= 2
  )
  select t.campo, t.valor, t.usos, t.ultimo, t.no_cadastro
    from (select * from do_cadastro union all select * from sugestao) t
   where is_org_member(p_org)
   order by t.no_cadastro desc, t.usos desc, t.campo nulls last, t.ordem, t.valor;
$$;
revoke execute on function org_pauta_uso(uuid) from public, anon, authenticated;
grant  execute on function org_pauta_uso(uuid) to authenticated;

-- ── CRUD (owner/admin; auth.uid(), nunca usuário por parâmetro) ──────────────
create or replace function org_pauta_pode(p_org uuid)
returns boolean language sql stable security definer set search_path to 'public' as $$
  select exists (
    select 1 from organization_members
     where org_id = p_org and user_id = auth.uid() and role in ('owner','admin')
  );
$$;
revoke execute on function org_pauta_pode(uuid) from public, anon, authenticated;
grant  execute on function org_pauta_pode(uuid) to authenticated;

-- Cria (p_id null) ou renomeia. Renomear não toca em título já gravado.
create or replace function org_pauta_salvar(p_org uuid, p_id uuid, p_campo text, p_valor text)
returns uuid language plpgsql security definer set search_path to 'public' as $$
declare v_id uuid; v_valor text := btrim(coalesce(p_valor, ''));
begin
  if not org_pauta_pode(p_org) then raise exception 'Acesso negado' using errcode = '42501'; end if;
  if v_valor = '' then raise exception 'A opção precisa de um nome'; end if;
  if p_campo not in ('veiculo','formato','objetivo') then
    raise exception 'Campo inválido: %', p_campo;
  end if;
  if lower(v_valor) = 'outro' then
    raise exception '"Outro" é a saída de emergência do formulário, não uma opção do cadastro';
  end if;
  -- ' - ' é o separador do título: deixar passar quebraria o parsing de quem vier depois.
  if v_valor like '%' || ' - ' || '%' then
    raise exception 'A opção não pode conter " - " (é o separador do título)';
  end if;

  if p_id is null then
    insert into org_pauta_opcao (org_id, campo, valor, ordem)
    values (p_org, p_campo, v_valor,
            (select coalesce(max(ordem), 0) + 10 from org_pauta_opcao
              where org_id = p_org and campo = p_campo))
    on conflict do nothing
    returning id into v_id;
    if v_id is null then raise exception 'A opção "%" já existe', v_valor; end if;
    return v_id;
  end if;

  update org_pauta_opcao set valor = v_valor
   where id = p_id and org_id = p_org and campo = p_campo;
  if not found then raise exception 'Opção não encontrada'; end if;
  return p_id;
end $$;
revoke execute on function org_pauta_salvar(uuid, uuid, text, text) from public, anon, authenticated;
grant  execute on function org_pauta_salvar(uuid, uuid, text, text) to authenticated;

-- Excluir é seguro: nenhuma tarefa aponta para a opção, o texto já está no título.
create or replace function org_pauta_excluir(p_org uuid, p_id uuid)
returns void language plpgsql security definer set search_path to 'public' as $$
begin
  if not org_pauta_pode(p_org) then raise exception 'Acesso negado' using errcode = '42501'; end if;
  delete from org_pauta_opcao where id = p_id and org_id = p_org;
  if not found then raise exception 'Opção não encontrada'; end if;
end $$;
revoke execute on function org_pauta_excluir(uuid, uuid) from public, anon, authenticated;
grant  execute on function org_pauta_excluir(uuid, uuid) to authenticated;

create or replace function org_pauta_reordenar(p_org uuid, p_campo text, p_ids uuid[])
returns void language plpgsql security definer set search_path to 'public' as $$
begin
  if not org_pauta_pode(p_org) then raise exception 'Acesso negado' using errcode = '42501'; end if;
  update org_pauta_opcao o set ordem = i.pos * 10
    from unnest(p_ids) with ordinality as i(id, pos)
   where o.id = i.id and o.org_id = p_org and o.campo = p_campo;
end $$;
revoke execute on function org_pauta_reordenar(uuid, text, uuid[]) from public, anon, authenticated;
grant  execute on function org_pauta_reordenar(uuid, text, uuid[]) to authenticated;

notify pgrst, 'reload schema';
