-- 224_rh_avaliacao_360.sql
-- Módulo RH — Fase 4: avaliação 360 + autoavaliação + clima.
--
-- Decisões do Rafael (08/08/2026):
--   · matriz montada pelo RH, com SUGESTÃO do sistema (gestor, liderados e os
--     pares que mais dividiram atividade no período — activity_focus);
--   · resposta identificada para o gestor/RH, EXCETO feedback ascendente
--     (liderado → próprio gestor), que nasce anônimo (toggle no ciclo);
--   · resultado visível para o próprio avaliado, o gestor dele e o RH;
--   · questionário = núcleo comum + bloco da função, com âncora comportamental.
--
-- ⭐ O anonimato aqui é ESTRUTURAL, não uma promessa da camada de leitura:
-- quando a relação é anônima no ciclo, `rh_aval_resposta.avaliador_id` fica
-- NULL — não existe linha ligando a resposta a quem respondeu, nem por SQL
-- direto. E a resposta NÃO guarda timestamp de propósito: `respondido_em` vive
-- no convite (o RH precisa cobrar quem falta), e um horário nos dois lados
-- permitiria cruzar "quem respondeu 14h32" com "resposta gravada 14h32".
--
-- O que NÃO é anonimizável e a tela precisa dizer em voz alta: autoavaliação
-- (é a própria pessoa) e nota do gestor sobre o liderado (só existe um gestor).
--
-- Idempotente.

-- ── Função avaliada (bloco do questionário) ─────────────────────────────────
-- Cargo é texto livre ("Diretor de Arte Júnior"); a função é a dimensão que
-- escolhe o bloco de competências. Palpite semeado do cargo, editável na ficha.
alter table rh_colaborador add column if not exists aval_funcao text;

-- ── Ciclo ───────────────────────────────────────────────────────────────────
create table if not exists rh_aval_ciclo (
  id            uuid primary key default gen_random_uuid(),
  org_id        uuid not null references organizations(id) on delete cascade,
  nome          text not null,
  tipo          text not null default '360',        -- 360 | clima
  status        text not null default 'rascunho',   -- rascunho | aberto | encerrado
  abre_em       date,
  fecha_em      date,
  -- Mínimo de respondentes por grupo antes de exibir média (anonimato em time
  -- pequeno). Não se aplica a auto/gestor: esses são identificáveis por
  -- construção e todo mundo sabe disso.
  min_respondentes int not null default 3,
  -- Visibilidade do NOME de quem respondeu, para gestor e RH.
  ident_par        boolean not null default true,   -- colega → colega
  ident_ascendente boolean not null default false,  -- liderado → seu gestor
  criado_por    uuid,
  created_at    timestamptz not null default now(),
  aberto_em     timestamptz,
  encerrado_em  timestamptz
);
create index if not exists rh_aval_ciclo_org_idx on rh_aval_ciclo (org_id, status);

-- ── Competência (cadastro editável pela org) ────────────────────────────────
create table if not exists rh_aval_competencia (
  id         uuid primary key default gen_random_uuid(),
  org_id     uuid not null references organizations(id) on delete cascade,
  bloco      text not null default 'comum',   -- comum | funcao | clima
  funcao     text,                             -- quando bloco='funcao'
  titulo     text not null,
  descricao  text,                             -- o comportamento observável
  ancoras    jsonb,                            -- BARS: {"1":"…","2":"…","3":"…","4":"…"}
  ordem      int not null default 0,
  ativa      boolean not null default true,
  created_at timestamptz not null default now()
);
create index if not exists rh_aval_comp_org_idx on rh_aval_competencia (org_id, bloco, ativa);

-- ── Convite (a matriz: quem avalia quem) ────────────────────────────────────
create table if not exists rh_aval_convite (
  id            uuid primary key default gen_random_uuid(),
  org_id        uuid not null references organizations(id) on delete cascade,
  ciclo_id      uuid not null references rh_aval_ciclo(id) on delete cascade,
  avaliador_id  uuid not null references rh_colaborador(id) on delete cascade,
  avaliado_id   uuid not null references rh_colaborador(id) on delete cascade,
  relacao       text not null,                 -- auto | par | gestor | liderado
  respondido_em timestamptz,
  created_at    timestamptz not null default now(),
  unique (ciclo_id, avaliador_id, avaliado_id)
);
create index if not exists rh_aval_convite_ciclo_idx on rh_aval_convite (ciclo_id, avaliado_id);
create index if not exists rh_aval_convite_avaliador_idx on rh_aval_convite (avaliador_id) where respondido_em is null;

-- ── Resposta ────────────────────────────────────────────────────────────────
-- SEM created_at de propósito (ver cabeçalho). `avaliador_id` só é gravado
-- quando a relação é identificada no ciclo.
create table if not exists rh_aval_resposta (
  id             uuid primary key default gen_random_uuid(),
  org_id         uuid not null references organizations(id) on delete cascade,
  ciclo_id       uuid not null references rh_aval_ciclo(id) on delete cascade,
  avaliado_id    uuid not null references rh_colaborador(id) on delete cascade,
  relacao        text not null,
  competencia_id uuid references rh_aval_competencia(id) on delete set null,
  nota           int,                           -- 1..4 · null = "não observei"
  comentario     text,
  avaliador_id   uuid references rh_colaborador(id) on delete set null
);
create index if not exists rh_aval_resp_ciclo_idx on rh_aval_resposta (ciclo_id, avaliado_id);

-- ── RLS ─────────────────────────────────────────────────────────────────────
-- Config é do RH. Convite e RESPOSTA não têm policy de leitura: passam só pelas
-- RPCs security definer — é o que impede alguém de ler resposta crua com o
-- próprio token.
alter table rh_aval_ciclo       enable row level security;
alter table rh_aval_competencia enable row level security;
alter table rh_aval_convite     enable row level security;
alter table rh_aval_resposta    enable row level security;

drop policy if exists rh_aval_ciclo_rw on rh_aval_ciclo;
create policy rh_aval_ciclo_rw on rh_aval_ciclo for all using (rh_can(org_id)) with check (rh_can(org_id));
drop policy if exists rh_aval_comp_rw on rh_aval_competencia;
create policy rh_aval_comp_rw on rh_aval_competencia for all using (rh_can(org_id)) with check (rh_can(org_id));
drop policy if exists rh_aval_convite_ro on rh_aval_convite;
create policy rh_aval_convite_ro on rh_aval_convite for select using (rh_can(org_id));
-- rh_aval_resposta: nenhuma policy. Nem o RH lê a linha crua.

-- ── Helper: o colaborador do usuário logado ─────────────────────────────────
create or replace function rh_colab_do_usuario()
returns uuid language sql stable security definer set search_path to 'public' as $$
  select id from rh_colaborador
   where membro_user_id = auth.uid() and status = 'ativo' and coalesce(arquivado, false) = false
   limit 1
$$;
revoke execute on function rh_colab_do_usuario() from public, anon;
grant  execute on function rh_colab_do_usuario() to authenticated;

-- ── Seed das competências (só se a org ainda não tem nenhuma) ───────────────
-- Âncoras de FREQUÊNCIA (raramente→sempre): 1 pergunta = 1 comportamento.
-- Melhor que Likert de concordância — ver a pesquisa no artefato do RH.
create or replace function rh_aval_semear(p_org uuid)
returns int language plpgsql security definer set search_path to 'public' as $$
declare v_n int := 0;
begin
  if not rh_can(p_org) then raise exception 'Acesso negado' using errcode = '42501'; end if;
  if exists (select 1 from rh_aval_competencia where org_id = p_org) then return 0; end if;

  insert into rh_aval_competencia (org_id, bloco, funcao, titulo, descricao, ancoras, ordem) values
  -- Núcleo comum
  (p_org,'comum',null,'Entrega no prazo','Cumpre o prazo combinado e avisa cedo quando vai furar.',
   '{"1":"Costuma estourar o prazo e avisar em cima da hora","2":"Às vezes atrasa, mas avisa","3":"Quase sempre entrega no prazo","4":"Entrega no prazo e antecipa risco"}'::jsonb,10),
  (p_org,'comum',null,'Qualidade da entrega','O trabalho volta pouco para retrabalho por erro evitável.',
   '{"1":"Volta com frequência por erro que dava para evitar","2":"Volta às vezes","3":"Raramente volta","4":"Entrega revisada, praticamente não volta"}'::jsonb,20),
  (p_org,'comum',null,'Colaboração','Ajuda quem precisa e divide o que sabe, mesmo fora do que é dele.',
   '{"1":"Fica no próprio escopo","2":"Ajuda quando pedem","3":"Se oferece com frequência","4":"Puxa o time junto, ensina e destrava os outros"}'::jsonb,30),
  (p_org,'comum',null,'Comunicação','Fala com clareza, no canal certo e na hora certa.',
   '{"1":"Some, some do contexto ou avisa tarde","2":"Comunica o básico","3":"Comunica bem e no tempo","4":"Antecipa o que o outro precisa saber"}'::jsonb,40),
  (p_org,'comum',null,'Autonomia','Toca o que é dele sem precisar ser cobrado a cada passo.',
   '{"1":"Precisa de cobrança constante","2":"Precisa de acompanhamento próximo","3":"Toca sozinho o que domina","4":"Assume ponta a ponta e traz solução pronta"}'::jsonb,50),
  (p_org,'comum',null,'Reação a feedback','Escuta crítica sem se fechar e aplica na entrega seguinte.',
   '{"1":"Se fecha ou repete o mesmo erro","2":"Escuta, mas custa a aplicar","3":"Aplica na maioria das vezes","4":"Busca feedback por conta e muda rápido"}'::jsonb,60),
  -- Redação
  (p_org,'funcao','redacao','Força do texto','O texto prende, tem ideia e serve ao objetivo — não é só correto.',
   '{"1":"Texto correto, mas genérico","2":"Funciona no básico","3":"Tem ideia e ritmo","4":"Texto que sustenta a campanha sozinho"}'::jsonb,110),
  (p_org,'funcao','redacao','Tom da marca','Acerta a voz de cada cliente sem precisar de correção.',
   '{"1":"Escreve sempre no mesmo tom","2":"Acerta com ajuste","3":"Acerta na maioria","4":"Troca de voz com naturalidade entre marcas"}'::jsonb,120),
  (p_org,'funcao','redacao','Apuração do briefing','Pergunta o que falta antes de escrever, em vez de adivinhar.',
   '{"1":"Escreve com o que veio, mesmo furado","2":"Pergunta quando trava","3":"Confere antes de começar","4":"Reconstrói o briefing e devolve melhor"}'::jsonb,130),
  -- Design
  (p_org,'funcao','design','Repertório visual','Traz solução com referência atual, não repete o mesmo layout.',
   '{"1":"Repete fórmula","2":"Varia pouco","3":"Traz referência boa","4":"Propõe caminho que eleva a marca"}'::jsonb,210),
  (p_org,'funcao','design','Consistência de marca','Respeita o manual do cliente sem engessar a peça.',
   '{"1":"Escapa do manual","2":"Segue com lembretes","3":"Segue bem","4":"Domina e sabe quando esticar com critério"}'::jsonb,220),
  (p_org,'funcao','design','Acabamento','Fecha arquivo limpo: medida, margem, exportação, versão certa.',
   '{"1":"Erro de fechamento é comum","2":"Escapa um detalhe às vezes","3":"Fecha limpo","4":"Arquivo impecável, pronto para produção"}'::jsonb,230),
  -- Atendimento
  (p_org,'funcao','atendimento','Leitura do cliente','Entende o que o cliente precisa, inclusive o que ele não sabe pedir.',
   '{"1":"Repassa pedido literal","2":"Entende o pedido","3":"Entende a necessidade por trás","4":"Antecipa e propõe antes de pedirem"}'::jsonb,310),
  (p_org,'funcao','atendimento','Condução de expectativa','Combina prazo e escopo realistas e segura o combinado.',
   '{"1":"Promete o que a casa não entrega","2":"Combina, mas cede fácil","3":"Segura o combinado","4":"Negocia bem e protege o time sem perder o cliente"}'::jsonb,320),
  (p_org,'funcao','atendimento','Retorno','Responde o cliente e o time em tempo, mesmo quando é "ainda não".',
   '{"1":"Deixa no vácuo","2":"Responde quando cobram","3":"Responde em tempo","4":"Retorna antes de ser cobrado"}'::jsonb,330),
  -- Mídia
  (p_org,'funcao','midia','Planejamento','Monta plano coerente com verba, objetivo e praça.',
   '{"1":"Plano solto do objetivo","2":"Plano funcional","3":"Plano bem amarrado","4":"Plano que muda o resultado do cliente"}'::jsonb,410),
  (p_org,'funcao','midia','Leitura de resultado','Lê o número e conclui algo além do print do relatório.',
   '{"1":"Reporta o número cru","2":"Comenta o número","3":"Tira conclusão","4":"Transforma dado em decisão de campanha"}'::jsonb,420),
  (p_org,'funcao','midia','Ajuste em voo','Percebe campanha ruim e corrige antes de queimar verba.',
   '{"1":"Só vê no fechamento","2":"Corrige quando alertam","3":"Acompanha e ajusta","4":"Antecipa e realoca sozinho"}'::jsonb,430),
  -- Gestão
  (p_org,'funcao','gestao','Direção clara','O time sabe a prioridade e o critério de pronto.',
   '{"1":"Prioridade muda sem aviso","2":"Direção aparece quando cobram","3":"Direção clara","4":"Time decide sozinho porque o critério está claro"}'::jsonb,510),
  (p_org,'funcao','gestao','Desenvolve o time','Dá feedback específico e cria chance de crescimento.',
   '{"1":"Só aponta erro","2":"Feedback genérico","3":"Feedback específico e regular","4":"Faz gente crescer de verdade"}'::jsonb,520),
  (p_org,'funcao','gestao','Decide e assume','Toma decisão difícil no tempo e banca o resultado.',
   '{"1":"Empurra decisão","2":"Decide com atraso","3":"Decide no tempo","4":"Decide e protege o time da consequência"}'::jsonb,530),
  -- Administrativo
  (p_org,'funcao','admin','Precisão','Número e registro conferem; erro de lançamento é raro.',
   '{"1":"Erro aparece com frequência","2":"Erro ocasional","3":"Confere antes de fechar","4":"Confiável a ponto de não precisar revisão"}'::jsonb,610),
  (p_org,'funcao','admin','Rotina em dia','Fecha o que é recorrente sem deixar acumular.',
   '{"1":"Acumula e vira urgência","2":"Fecha no limite","3":"Fecha em dia","4":"Fecha antes e ainda melhora o processo"}'::jsonb,620),
  (p_org,'funcao','admin','Zelo com o sigilo','Trata dado sensível (folha, contrato) com o cuidado devido.',
   '{"1":"Comenta o que não devia","2":"Cuida quando lembram","3":"Cuida sempre","4":"É referência de discrição na casa"}'::jsonb,630);

  get diagnostics v_n = row_count;

  -- Palpite da função a partir do cargo — o RH ajusta na ficha.
  update rh_colaborador set aval_funcao = case
    when cargo ~* 'redat|copy'                    then 'redacao'
    when cargo ~* 'arte|design|criaç|criac'       then 'design'
    when cargo ~* 'atendimento'                   then 'atendimento'
    when cargo ~* 'mídia|midia'                   then 'midia'
    when cargo ~* 'social'                        then 'redacao'
    when cargo ~* 'diretor|sóci|soci|gerent|coord' then 'gestao'
    when cargo ~* 'administrativ|financ'          then 'admin'
    else null end
  where org_id = p_org and aval_funcao is null;

  return v_n;
end $$;
revoke execute on function rh_aval_semear(uuid) from public, anon;
grant  execute on function rh_aval_semear(uuid) to authenticated;

-- ── Sugestão da matriz (não grava: devolve para o RH revisar) ───────────────
-- Pares vêm de quem DIVIDIU ATIVIDADE de verdade (activity_focus), não do
-- organograma: numa agência quem trabalha junto nem sempre é do mesmo time.
create or replace function rh_aval_sugerir(p_ciclo uuid, p_dias int default 120, p_max_pares int default 5)
returns jsonb language plpgsql stable security definer set search_path to 'public' as $$
declare v_org uuid; v_out jsonb := '[]'::jsonb; a record; v_lin jsonb;
begin
  select org_id into v_org from rh_aval_ciclo where id = p_ciclo;
  if v_org is null then raise exception 'Ciclo não encontrado'; end if;
  if not rh_can(v_org) then raise exception 'Acesso negado' using errcode = '42501'; end if;

  for a in
    select c.id, c.nome, c.cargo, c.aval_funcao, c.gestor_id, c.membro_user_id
      from rh_colaborador c
     where c.org_id = v_org and c.status = 'ativo' and not c.arquivado
     order by c.nome
  loop
    v_lin := jsonb_build_object(
      'avaliado_id', a.id, 'nome', a.nome, 'cargo', a.cargo, 'funcao', a.aval_funcao,
      'auto', true,
      'gestor', (select jsonb_build_object('id', g.id, 'nome', g.nome)
                   from rh_colaborador g where g.id = a.gestor_id and g.status = 'ativo' and not g.arquivado),
      'liderados', coalesce((select jsonb_agg(jsonb_build_object('id', l.id, 'nome', l.nome) order by l.nome)
                     from rh_colaborador l
                    where l.gestor_id = a.id and l.status = 'ativo' and not l.arquivado
                      and l.membro_user_id is not null), '[]'::jsonb),
      -- Pares: quem mais abriu as MESMAS atividades no período, fora gestor/liderados.
      'pares', coalesce((
        select jsonb_agg(x.j order by x.n desc)
          from (
            select jsonb_build_object('id', o.id, 'nome', o.nome, 'juntos', count(distinct f1.activity_id)) as j,
                   count(distinct f1.activity_id) as n
              from activity_focus f1
              join activity_focus f2 on f2.activity_id = f1.activity_id and f2.user_id <> f1.user_id
              join rh_colaborador o on o.membro_user_id = f2.user_id
                                   and o.org_id = v_org and o.status = 'ativo' and not o.arquivado
             where f1.user_id = a.membro_user_id
               and f1.aberta_em >= now() - make_interval(days => greatest(1, coalesce(p_dias, 120)))
               and o.id <> a.id
               and o.id is distinct from a.gestor_id
               and not exists (select 1 from rh_colaborador l where l.id = o.id and l.gestor_id = a.id)
             group by o.id, o.nome
             order by count(distinct f1.activity_id) desc
             limit greatest(1, coalesce(p_max_pares, 5))
          ) x), '[]'::jsonb));
    v_out := v_out || v_lin;
  end loop;

  return v_out;
end $$;
revoke execute on function rh_aval_sugerir(uuid, int, int) from public, anon;
grant  execute on function rh_aval_sugerir(uuid, int, int) to authenticated;

-- ── Gravar a matriz revisada ────────────────────────────────────────────────
-- p_pares: [{"avaliado_id":…, "avaliadores":[{"id":…, "relacao":"par"}, …]}, …]
create or replace function rh_aval_definir_matriz(p_ciclo uuid, p_matriz jsonb)
returns int language plpgsql security definer set search_path to 'public' as $$
declare v_org uuid; v_status text; v_n int := 0; r jsonb; av jsonb; v_rel text;
begin
  select org_id, status into v_org, v_status from rh_aval_ciclo where id = p_ciclo;
  if v_org is null then raise exception 'Ciclo não encontrado'; end if;
  if not rh_can(v_org) then raise exception 'Acesso negado' using errcode = '42501'; end if;
  if v_status = 'encerrado' then raise exception 'Ciclo encerrado'; end if;

  -- Convite já respondido não é removido: a resposta dele já existe.
  delete from rh_aval_convite where ciclo_id = p_ciclo and respondido_em is null;

  for r in select * from jsonb_array_elements(coalesce(p_matriz, '[]'::jsonb)) loop
    for av in select * from jsonb_array_elements(coalesce(r->'avaliadores', '[]'::jsonb)) loop
      v_rel := coalesce(av->>'relacao', 'par');
      if v_rel not in ('auto','par','gestor','liderado') then
        raise exception 'Relação inválida: %', v_rel;
      end if;
      insert into rh_aval_convite (org_id, ciclo_id, avaliador_id, avaliado_id, relacao)
      values (v_org, p_ciclo, (av->>'id')::uuid, (r->>'avaliado_id')::uuid, v_rel)
      on conflict (ciclo_id, avaliador_id, avaliado_id) do nothing;
      v_n := v_n + 1;
    end loop;
  end loop;

  return v_n;
end $$;
revoke execute on function rh_aval_definir_matriz(uuid, jsonb) from public, anon;
grant  execute on function rh_aval_definir_matriz(uuid, jsonb) to authenticated;

-- ── Abrir / encerrar ────────────────────────────────────────────────────────
create or replace function rh_aval_status(p_ciclo uuid, p_status text)
returns void language plpgsql security definer set search_path to 'public' as $$
declare v_org uuid;
begin
  select org_id into v_org from rh_aval_ciclo where id = p_ciclo;
  if v_org is null then raise exception 'Ciclo não encontrado'; end if;
  if not rh_can(v_org) then raise exception 'Acesso negado' using errcode = '42501'; end if;
  if p_status not in ('rascunho','aberto','encerrado') then raise exception 'Status inválido'; end if;
  if p_status = 'aberto' and not exists (select 1 from rh_aval_convite where ciclo_id = p_ciclo) then
    raise exception 'Monte a matriz antes de abrir o ciclo.';
  end if;

  update rh_aval_ciclo set status = p_status,
    aberto_em    = case when p_status = 'aberto'    then coalesce(aberto_em, now()) else aberto_em end,
    encerrado_em = case when p_status = 'encerrado' then now() else null end
  where id = p_ciclo;
end $$;
revoke execute on function rh_aval_status(uuid, text) from public, anon;
grant  execute on function rh_aval_status(uuid, text) to authenticated;

-- ── O que EU tenho para responder ───────────────────────────────────────────
create or replace function rh_aval_minhas_pendencias()
returns jsonb language plpgsql stable security definer set search_path to 'public' as $$
declare v_colab uuid; v_out jsonb;
begin
  v_colab := rh_colab_do_usuario();
  if v_colab is null then return '[]'::jsonb; end if;

  select coalesce(jsonb_agg(jsonb_build_object(
           'convite_id', cv.id, 'ciclo_id', ci.id, 'ciclo', ci.nome, 'tipo', ci.tipo,
           'fecha_em', ci.fecha_em, 'relacao', cv.relacao,
           'avaliado_id', al.id, 'avaliado', al.nome, 'cargo', al.cargo,
           'respondido', cv.respondido_em is not null,
           -- A tela DIZ quem vai ler. Sem isso, a pessoa responde achando que é
           -- anônimo quando não é — e é assim que se perde a confiança no 360.
           'identificado', case cv.relacao
             when 'auto'     then true
             when 'gestor'   then true
             when 'par'      then ci.ident_par
             when 'liderado' then ci.ident_ascendente end)
           order by cv.respondido_em nulls first, al.nome), '[]'::jsonb)
    into v_out
    from rh_aval_convite cv
    join rh_aval_ciclo ci on ci.id = cv.ciclo_id
    join rh_colaborador al on al.id = cv.avaliado_id
   where cv.avaliador_id = v_colab and ci.status = 'aberto';

  return v_out;
end $$;
revoke execute on function rh_aval_minhas_pendencias() from public, anon;
grant  execute on function rh_aval_minhas_pendencias() to authenticated;

-- ── Questionário de um convite ──────────────────────────────────────────────
-- ⚠️ A variável do record NÃO pode se chamar `cv`: o PL/pgSQL resolveria o
-- `cv.*` do SELECT como a própria variável (ainda vazia) em vez do alias da
-- tabela, e a função morre com "record is not assigned yet".
create or replace function rh_aval_questionario(p_convite uuid)
returns jsonb language plpgsql stable security definer set search_path to 'public' as $$
declare v_colab uuid; v_cv record; v_ident boolean; v_comp jsonb;
begin
  v_colab := rh_colab_do_usuario();
  select cv.*, ci.tipo, ci.status, ci.nome as ciclo, ci.ident_par, ci.ident_ascendente,
         al.nome as avaliado_nome, al.cargo as avaliado_cargo, al.aval_funcao
    into v_cv
    from rh_aval_convite cv
    join rh_aval_ciclo ci on ci.id = cv.ciclo_id
    join rh_colaborador al on al.id = cv.avaliado_id
   where cv.id = p_convite;
  if v_cv.id is null then raise exception 'Convite não encontrado'; end if;
  if v_cv.avaliador_id <> v_colab then raise exception 'Acesso negado' using errcode = '42501'; end if;
  if v_cv.status <> 'aberto' then raise exception 'Este ciclo não está aberto.'; end if;

  v_ident := case v_cv.relacao when 'auto' then true when 'gestor' then true
                               when 'par' then v_cv.ident_par else v_cv.ident_ascendente end;

  select coalesce(jsonb_agg(jsonb_build_object(
           'id', k.id, 'bloco', k.bloco, 'titulo', k.titulo,
           'descricao', k.descricao, 'ancoras', k.ancoras) order by k.ordem), '[]'::jsonb)
    into v_comp
    from rh_aval_competencia k
   where k.org_id = v_cv.org_id and k.ativa
     and case when v_cv.tipo = 'clima' then k.bloco = 'clima'
              else k.bloco = 'comum' or (k.bloco = 'funcao' and k.funcao = v_cv.aval_funcao) end;

  return jsonb_build_object(
    'convite_id', v_cv.id, 'ciclo', v_cv.ciclo, 'tipo', v_cv.tipo, 'relacao', v_cv.relacao,
    'avaliado', v_cv.avaliado_nome, 'cargo', v_cv.avaliado_cargo,
    'identificado', v_ident,
    'respondido', v_cv.respondido_em is not null,
    'competencias', v_comp);
end $$;
revoke execute on function rh_aval_questionario(uuid) from public, anon;
grant  execute on function rh_aval_questionario(uuid) to authenticated;

-- ── Responder ───────────────────────────────────────────────────────────────
-- p_respostas: [{"competencia_id":…, "nota":1..4|null, "comentario":"…"}, …]
create or replace function rh_aval_responder(p_convite uuid, p_respostas jsonb)
returns void language plpgsql security definer set search_path to 'public' as $$
declare v_colab uuid; v_cv record; v_ident boolean; r jsonb; v_nota int;
begin
  v_colab := rh_colab_do_usuario();
  select cv.*, ci.status, ci.ident_par, ci.ident_ascendente
    into v_cv
    from rh_aval_convite cv join rh_aval_ciclo ci on ci.id = cv.ciclo_id
   where cv.id = p_convite;
  if v_cv.id is null then raise exception 'Convite não encontrado'; end if;
  if v_cv.avaliador_id <> v_colab then raise exception 'Acesso negado' using errcode = '42501'; end if;
  if v_cv.status <> 'aberto' then raise exception 'Este ciclo não está aberto.'; end if;
  if v_cv.respondido_em is not null then raise exception 'Você já respondeu esta avaliação.'; end if;

  v_ident := case v_cv.relacao when 'auto' then true when 'gestor' then true
                               when 'par' then v_cv.ident_par else v_cv.ident_ascendente end;

  for r in select * from jsonb_array_elements(coalesce(p_respostas, '[]'::jsonb)) loop
    v_nota := nullif(r->>'nota', '')::int;      -- null = "não observei"
    if v_nota is not null and (v_nota < 1 or v_nota > 4) then
      raise exception 'Nota fora da escala (1 a 4).';
    end if;
    insert into rh_aval_resposta (org_id, ciclo_id, avaliado_id, relacao, competencia_id,
                                  nota, comentario, avaliador_id)
    values (v_cv.org_id, v_cv.ciclo_id, v_cv.avaliado_id, v_cv.relacao, (r->>'competencia_id')::uuid,
            v_nota, nullif(btrim(coalesce(r->>'comentario','')), ''),
            -- Anônimo é anônimo no BANCO: relação não identificada não grava quem.
            case when v_ident then v_colab else null end);
  end loop;

  update rh_aval_convite set respondido_em = now() where id = p_convite;
end $$;
revoke execute on function rh_aval_responder(uuid, jsonb) from public, anon;
grant  execute on function rh_aval_responder(uuid, jsonb) to authenticated;

-- ── Resultado agregado de uma pessoa ────────────────────────────────────────
-- Vê: o próprio avaliado, o gestor dele e o RH. O avaliado NUNCA vê nomes —
-- essa parte não é configurável, é o que sustenta a resposta honesta.
create or replace function rh_aval_resultado(p_ciclo uuid, p_avaliado uuid)
returns jsonb language plpgsql stable security definer set search_path to 'public' as $$
declare
  v_org uuid; v_min int; v_ident_par boolean; v_ident_asc boolean;
  v_colab uuid; v_rh boolean; v_eu_gestor boolean; v_eu_avaliado boolean; v_ver_nome boolean;
  v_comp jsonb; v_coment jsonb; v_status text;
begin
  select org_id, min_respondentes, ident_par, ident_ascendente, status
    into v_org, v_min, v_ident_par, v_ident_asc, v_status
    from rh_aval_ciclo where id = p_ciclo;
  if v_org is null then raise exception 'Ciclo não encontrado'; end if;

  v_colab       := rh_colab_do_usuario();
  v_rh          := rh_can(v_org);
  v_eu_avaliado := (v_colab is not null and v_colab = p_avaliado);
  v_eu_gestor   := exists (select 1 from rh_colaborador where id = p_avaliado and gestor_id = v_colab);
  if not (v_rh or v_eu_avaliado or v_eu_gestor) then
    raise exception 'Acesso negado' using errcode = '42501';
  end if;
  -- Resultado só depois de encerrado: ver parcial enquanto o ciclo corre
  -- pressiona quem ainda não respondeu.
  if v_status <> 'encerrado' and not v_rh then
    raise exception 'O resultado sai quando o ciclo for encerrado.';
  end if;

  v_ver_nome := (v_rh or v_eu_gestor) and not v_eu_avaliado;

  -- Média por competência e por grupo.
  --
  -- Grupo abaixo do mínimo NÃO é simplesmente escondido: ele é FUNDIDO no balde
  -- "equipe". Só esconder abriria um vazamento por subtração — com o total
  -- visível e os demais grupos à mostra, a média do grupo oculto se calcula, e
  -- num grupo de 2 isso praticamente entrega quem disse o quê.
  --
  -- auto e gestor não têm mínimo: é uma pessoa só e todo mundo sabe quem é
  -- (por isso a tela avisa quem responde nessas duas relações).
  -- O "geral" é a visão de TERCEIROS (exclui a autoavaliação, que distorceria)
  -- e só aparece com respondentes suficientes.
  select coalesce(jsonb_agg(x.j order by x.ordem), '[]'::jsonb) into v_comp from (
    select k.ordem, jsonb_build_object(
      'competencia', k.titulo, 'bloco', k.bloco, 'descricao', k.descricao,
      'grupos', g.grupos, 'geral', g.geral) as j
    from rh_aval_competencia k
    cross join lateral (
      with base as (
        select rp.relacao, rp.nota
          from rh_aval_resposta rp
         where rp.ciclo_id = p_ciclo and rp.avaliado_id = p_avaliado
           and rp.competencia_id = k.id and rp.nota is not null
      ),
      cnt as (select relacao, count(*) as n from base group by relacao),
      rot as (
        select b.nota,
               case when b.relacao in ('auto','gestor') then b.relacao
                    when c.n >= v_min then b.relacao
                    else 'equipe' end as rotulo
          from base b join cnt c on c.relacao = b.relacao
      ),
      agg as (
        select rotulo, round(avg(nota)::numeric, 2) as media, count(*) as n
          from rot group by rotulo
         having rotulo in ('auto','gestor') or count(*) >= v_min
      )
      select coalesce(jsonb_object_agg(agg.rotulo, jsonb_build_object('media', agg.media, 'n', agg.n)),
                      '{}'::jsonb) as grupos,
             -- O geral agrega SÓ o que está visível. Incluir resposta de grupo
             -- oculto reabriria a subtração pelo outro lado: com "par" à mostra
             -- (n=3, média 3,00) e um geral de n=4, a nota do único liderado sai
             -- por conta — e é justamente quem respondeu sob anonimato.
             (select case when count(*) >= v_min then round(avg(r2.nota)::numeric, 2) end
                from rot r2
               where r2.rotulo <> 'auto'
                 and r2.rotulo in (select agg.rotulo from agg)) as geral
        from agg
    ) g
   where k.org_id = v_org
     and exists (select 1 from rh_aval_resposta rp
                  where rp.ciclo_id = p_ciclo and rp.avaliado_id = p_avaliado and rp.competencia_id = k.id)
  ) x;

  -- Comentários: nome só para quem pode ver E só quando a relação é identificada.
  select coalesce(jsonb_agg(jsonb_build_object(
           'relacao', rp.relacao, 'texto', rp.comentario,
           'competencia', k.titulo,
           'por', case when v_ver_nome then (select nome from rh_colaborador where id = rp.avaliador_id) end)), '[]'::jsonb)
    into v_coment
    from rh_aval_resposta rp
    left join rh_aval_competencia k on k.id = rp.competencia_id
   where rp.ciclo_id = p_ciclo and rp.avaliado_id = p_avaliado
     and coalesce(btrim(rp.comentario), '') <> '';

  return jsonb_build_object(
    'avaliado', (select jsonb_build_object('id', id, 'nome', nome, 'cargo', cargo)
                   from rh_colaborador where id = p_avaliado),
    'ciclo', (select jsonb_build_object('id', id, 'nome', nome, 'status', status) from rh_aval_ciclo where id = p_ciclo),
    'min_respondentes', v_min,
    'ver_nome', v_ver_nome,
    'respondentes', (select count(*) from rh_aval_convite where ciclo_id = p_ciclo
                      and avaliado_id = p_avaliado and respondido_em is not null),
    'convidados', (select count(*) from rh_aval_convite where ciclo_id = p_ciclo and avaliado_id = p_avaliado),
    'competencias', v_comp,
    'comentarios', v_coment);
end $$;
revoke execute on function rh_aval_resultado(uuid, uuid) from public, anon;
grant  execute on function rh_aval_resultado(uuid, uuid) to authenticated;

-- ── Progresso do ciclo (RH) ─────────────────────────────────────────────────
create or replace function rh_aval_progresso(p_ciclo uuid)
returns jsonb language plpgsql stable security definer set search_path to 'public' as $$
declare v_org uuid;
begin
  select org_id into v_org from rh_aval_ciclo where id = p_ciclo;
  if v_org is null then raise exception 'Ciclo não encontrado'; end if;
  if not rh_can(v_org) then raise exception 'Acesso negado' using errcode = '42501'; end if;

  return jsonb_build_object(
    'por_avaliado', coalesce((
      select jsonb_agg(jsonb_build_object(
        'avaliado_id', al.id, 'nome', al.nome, 'cargo', al.cargo,
        'convidados', count(*), 'respondidos', count(cv.respondido_em)) order by al.nome)
        from rh_aval_convite cv join rh_colaborador al on al.id = cv.avaliado_id
       where cv.ciclo_id = p_ciclo group by al.id, al.nome, al.cargo), '[]'::jsonb),
    -- Quem ainda deve responder. É o convite (não a resposta) que diz isso —
    -- por isso cobrar quem falta não revela o que ninguém respondeu.
    'por_avaliador', coalesce((
      select jsonb_agg(jsonb_build_object(
        'avaliador_id', av.id, 'nome', av.nome,
        'pendentes', count(*) filter (where cv.respondido_em is null),
        'total', count(*)) order by av.nome)
        from rh_aval_convite cv join rh_colaborador av on av.id = cv.avaliador_id
       where cv.ciclo_id = p_ciclo group by av.id, av.nome), '[]'::jsonb));
end $$;
revoke execute on function rh_aval_progresso(uuid) from public, anon;
grant  execute on function rh_aval_progresso(uuid) to authenticated;

notify pgrst, 'reload schema';
