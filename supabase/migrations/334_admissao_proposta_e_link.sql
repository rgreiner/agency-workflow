-- 334: contratação como esteira — proposta, link de aceite e ficha (08/10/2026).
--
-- Hoje: carta oferta escrita à mão no Drive → PDF → WhatsApp → "aceito" por
-- mensagem → ficha de admissão digitada pelo RH com dados que só o candidato
-- tem (mãe, RG, PIS, CTPS, banco) → PDF para a contabilidade → exame médico →
-- cadastro no RH. Cinco ferramentas e nenhum rastro de quando cada coisa
-- aconteceu.
--
-- A esteira vira UMA linha em rh_admissao, com um token por candidato (mesmo
-- padrão da cotação de fornecedores, mig. 310/311): a página pública não tem
-- sessão e fala com o banco pela conexão direta (flow_auth), SEMPRE a partir do
-- token — nunca de um id vindo do browser.
--
-- LGPD: são dados de quem ainda não é funcionário, incluindo CPF de
-- dependentes. Leitura só com rh_can, escrita só por estas funções, link com
-- validade e `rh_admissao_limpar_dados` para apagar o conteúdo pessoal quando o
-- processo morre, preservando só o registro de que existiu.
-- Idempotente.

create table if not exists rh_admissao (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id) on delete cascade,

  -- ── Proposta (o RH preenche) ──────────────────────────────────────────
  nome text not null,
  email text,
  telefone text,
  cargo text,
  tipo_vinculo text not null default 'clt',
  salario numeric(12,2),
  data_inicio date,
  data_primeiro_pagamento date,
  local_trabalho text,
  -- {entrada, intervalo_ini, intervalo_fim, saida, dias_semana[], horas_semanais}
  jornada jsonb not null default '{}'::jsonb,
  -- {va_dia, va_desconto_pct, vt, vt_desconto_pct, ajuda_custo, ajuda_custo_nome, extras[]}
  beneficios jsonb not null default '{}'::jsonb,
  -- Corpo da carta já montado, editável antes de enviar (como o e-mail do
  -- fechamento): o texto é da casa, não meu.
  carta text,

  -- ── Link ──────────────────────────────────────────────────────────────
  token text unique,
  expira_em date,
  enviada_em timestamptz,
  aberta_em timestamptz,

  -- ── Resposta do candidato ─────────────────────────────────────────────
  aceita_em timestamptz,
  recusada_em timestamptz,
  recusa_motivo text,
  -- O aceite é um clique (decisão do Rafael, 08/10). IP e hora ficam porque
  -- não custam nada a ele e são o que sustenta a proposta se for contestada.
  aceite_ip text,
  aceite_agente text,

  -- ── Ficha de admissão (o candidato preenche) ──────────────────────────
  ficha jsonb,
  ficha_em timestamptz,

  -- ── Exame admissional ─────────────────────────────────────────────────
  exame_em timestamptz,
  exame_local text,

  -- ── Desfecho ──────────────────────────────────────────────────────────
  -- rascunho | enviada | aceita | recusada | ficha | efetivada | cancelada
  status text not null default 'rascunho',
  colaborador_id uuid references rh_colaborador(id) on delete set null,
  efetivada_em timestamptz,
  observacao text,
  dados_limpos_em timestamptz,

  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists rh_admissao_org on rh_admissao (org_id, created_at desc);
create index if not exists rh_admissao_status on rh_admissao (org_id, status);

-- Anexos do candidato. Ficam fora de rh_documento porque ainda não existe ficha
-- de colaborador; na efetivação eles passam para lá.
create table if not exists rh_admissao_doc (
  id uuid primary key default gen_random_uuid(),
  admissao_id uuid not null references rh_admissao(id) on delete cascade,
  tipo text not null,
  nome text,
  chave text not null,
  enviado_em timestamptz not null default now()
);
create index if not exists rh_admissao_doc_adm on rh_admissao_doc (admissao_id);

alter table rh_admissao enable row level security;
alter table rh_admissao_doc enable row level security;

-- Leitura só de quem responde pelo RH; escrita só pelas funções abaixo.
drop policy if exists "RH lê admissões" on rh_admissao;
create policy "RH lê admissões" on rh_admissao for select using (rh_can(org_id));
drop policy if exists "RH lê anexos da admissão" on rh_admissao_doc;
create policy "RH lê anexos da admissão" on rh_admissao_doc for select using (
  exists (select 1 from rh_admissao a where a.id = admissao_id and rh_can(a.org_id)));

-- ── Configuração da casa (cadastro, nunca constante no código) ────────────
-- {exame_local, exame_horarios, exame_observacao, documentos:[{tipo,label,obrigatorio}]}
alter table org_settings add column if not exists rh_admissao jsonb;

-- Semente da One a One, no mesmo espírito dos e-mails da contabilidade: a
-- clínica e a lista de documentos são dados da casa, editáveis na tela.
update org_settings s set rh_admissao = jsonb_build_object(
  'exame_local', 'Facilita Gestão de Riscos Ocupacionais — Rua Recife, 348 (em frente à Dínamo materiais elétricos, perto da panificadora Pão de Ló)',
  'exame_horarios', 'Atendimento médico das 07:30 às 12:00 e das 13:30 às 15:00',
  'exame_observacao', 'Leve um documento com foto. O exame admissional precisa estar feito antes do primeiro dia de trabalho.',
  'documentos', jsonb_build_array(
    jsonb_build_object('tipo', 'rg',         'label', 'RG (frente e verso)',            'obrigatorio', true),
    jsonb_build_object('tipo', 'cpf',        'label', 'CPF',                            'obrigatorio', true),
    jsonb_build_object('tipo', 'residencia', 'label', 'Comprovante de residência',      'obrigatorio', true),
    jsonb_build_object('tipo', 'ctps',       'label', 'Carteira de trabalho digital',   'obrigatorio', true),
    jsonb_build_object('tipo', 'foto',       'label', 'Foto 3x4 (ou selfie nítida)',    'obrigatorio', false),
    jsonb_build_object('tipo', 'titulo',     'label', 'Título de eleitor',              'obrigatorio', false),
    jsonb_build_object('tipo', 'dependente', 'label', 'Certidão de nascimento dos filhos', 'obrigatorio', false)),
  -- Benefícios da casa: a proposta nasce com eles preenchidos e o RH ajusta por
  -- candidato. Valor em código viraria "mudou o VA, cadê?" (regra da casa).
  'beneficios_padrao', jsonb_build_object(
    'va_dia', 34, 'va_desconto_pct', 20,
    'vt', true, 'vt_desconto_pct', 6,
    'ajuda_custo', 150, 'ajuda_custo_nome', 'pacote Adobe',
    'extras', jsonb_build_array('happy hour especial na última sexta-feira de cada mês')))
from organizations o
where o.id = s.org_id and o.slug = 'one-a-one' and s.rh_admissao is null;

-- Completa o cadastro de quem já tinha a semente anterior (a de cima só roda
-- quando rh_admissao está vazio).
update org_settings s
   set rh_admissao = jsonb_set(coalesce(s.rh_admissao, '{}'::jsonb), '{beneficios_padrao}',
         jsonb_build_object(
           'va_dia', 34, 'va_desconto_pct', 20,
           'vt', true, 'vt_desconto_pct', 6,
           'ajuda_custo', 150, 'ajuda_custo_nome', 'pacote Adobe',
           'extras', jsonb_build_array('happy hour especial na última sexta-feira de cada mês')))
  from organizations o
 where o.id = s.org_id and o.slug = 'one-a-one' and (s.rh_admissao->'beneficios_padrao') is null;

-- ── Escrita pelo RH ───────────────────────────────────────────────────────
create or replace function rh_admissao_salvar(p_org uuid, p_id uuid, p_dados jsonb)
returns uuid language plpgsql security definer set search_path to 'public' as $$
declare v_id uuid;
begin
  if not rh_can(p_org) then raise exception 'Acesso negado' using errcode = '42501'; end if;
  if coalesce(nullif(p_dados->>'nome',''), '') = '' then raise exception 'Informe o nome do candidato'; end if;

  if p_id is null then
    insert into rh_admissao (org_id, nome, email, telefone, cargo, tipo_vinculo, salario,
      data_inicio, data_primeiro_pagamento, local_trabalho, jornada, beneficios, carta,
      exame_em, exame_local, observacao, created_by)
    values (p_org,
      p_dados->>'nome', nullif(p_dados->>'email',''), nullif(p_dados->>'telefone',''),
      nullif(p_dados->>'cargo',''), coalesce(nullif(p_dados->>'tipo_vinculo',''), 'clt'),
      nullif(p_dados->>'salario','')::numeric,
      nullif(p_dados->>'data_inicio','')::date, nullif(p_dados->>'data_primeiro_pagamento','')::date,
      nullif(p_dados->>'local_trabalho',''),
      coalesce(p_dados->'jornada', '{}'::jsonb), coalesce(p_dados->'beneficios', '{}'::jsonb),
      nullif(p_dados->>'carta',''),
      nullif(p_dados->>'exame_em','')::timestamptz, nullif(p_dados->>'exame_local',''),
      nullif(p_dados->>'observacao',''), auth.uid())
    returning id into v_id;
  else
    update rh_admissao set
      nome = coalesce(nullif(p_dados->>'nome',''), nome),
      email = nullif(p_dados->>'email',''), telefone = nullif(p_dados->>'telefone',''),
      cargo = nullif(p_dados->>'cargo',''),
      tipo_vinculo = coalesce(nullif(p_dados->>'tipo_vinculo',''), tipo_vinculo),
      salario = nullif(p_dados->>'salario','')::numeric,
      data_inicio = nullif(p_dados->>'data_inicio','')::date,
      data_primeiro_pagamento = nullif(p_dados->>'data_primeiro_pagamento','')::date,
      local_trabalho = nullif(p_dados->>'local_trabalho',''),
      jornada = coalesce(p_dados->'jornada', jornada),
      beneficios = coalesce(p_dados->'beneficios', beneficios),
      carta = coalesce(nullif(p_dados->>'carta',''), carta),
      exame_em = nullif(p_dados->>'exame_em','')::timestamptz,
      exame_local = nullif(p_dados->>'exame_local',''),
      observacao = nullif(p_dados->>'observacao',''),
      updated_at = now()
    where id = p_id and org_id = p_org
    returning id into v_id;
    if v_id is null then raise exception 'Processo não encontrado'; end if;
  end if;
  return v_id;
end $$;

/** Publica o link: fixa o token (gerado no servidor) e a validade. */
create or replace function rh_admissao_enviar(p_id uuid, p_token text, p_dias int default 15)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare a rh_admissao;
begin
  select * into a from rh_admissao where id = p_id;
  if a.id is null then raise exception 'Processo não encontrado'; end if;
  if not rh_can(a.org_id) then raise exception 'Acesso negado' using errcode = '42501'; end if;
  if a.aceita_em is not null or a.recusada_em is not null then
    raise exception 'Esta proposta já foi respondida';
  end if;

  update rh_admissao set
    token = coalesce(token, p_token),
    expira_em = ((now() at time zone 'America/Sao_Paulo')::date + greatest(1, coalesce(p_dias, 15))),
    enviada_em = coalesce(enviada_em, now()),
    status = case when status = 'rascunho' then 'enviada' else status end,
    updated_at = now()
  where id = p_id
  returning * into a;

  return jsonb_build_object('token', a.token, 'expira_em', a.expira_em, 'status', a.status);
end $$;

create or replace function rh_admissao_cancelar(p_id uuid, p_motivo text)
returns void language plpgsql security definer set search_path to 'public' as $$
declare v_org uuid;
begin
  select org_id into v_org from rh_admissao where id = p_id;
  if v_org is null then raise exception 'Processo não encontrado'; end if;
  if not rh_can(v_org) then raise exception 'Acesso negado' using errcode = '42501'; end if;
  -- Token zerado: o link para de abrir no mesmo instante.
  update rh_admissao set status = 'cancelada', token = null,
    observacao = coalesce(nullif(p_motivo,''), observacao), updated_at = now()
  where id = p_id;
end $$;

/** LGPD: apaga o conteúdo pessoal e mantém só o esqueleto do processo. */
create or replace function rh_admissao_limpar_dados(p_id uuid)
returns void language plpgsql security definer set search_path to 'public' as $$
declare v_org uuid;
begin
  select org_id into v_org from rh_admissao where id = p_id;
  if v_org is null then raise exception 'Processo não encontrado'; end if;
  if not rh_can(v_org) then raise exception 'Acesso negado' using errcode = '42501'; end if;
  delete from rh_admissao_doc where admissao_id = p_id;
  update rh_admissao set
    ficha = null, email = null, telefone = null, aceite_ip = null, aceite_agente = null,
    token = null, dados_limpos_em = now(), updated_at = now()
  where id = p_id;
end $$;

-- ── Página pública (só pelo token, executada pelo flow_auth) ──────────────
create or replace function rh_admissao_por_token(p_token text)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare v jsonb;
begin
  select jsonb_build_object(
    'id', a.id, 'nome', a.nome, 'cargo', a.cargo, 'carta', a.carta,
    'agencia', o.name, 'org_slug', o.slug,
    'status', a.status, 'expira_em', a.expira_em,
    'aceita_em', a.aceita_em, 'recusada_em', a.recusada_em,
    'data_inicio', a.data_inicio, 'salario', a.salario,
    'ficha', a.ficha, 'ficha_em', a.ficha_em,
    'exame_em', a.exame_em,
    'exame_local', coalesce(a.exame_local, s.rh_admissao->>'exame_local'),
    'exame_horarios', s.rh_admissao->>'exame_horarios',
    'exame_observacao', s.rh_admissao->>'exame_observacao',
    'documentos_pedidos', coalesce(s.rh_admissao->'documentos', '[]'::jsonb),
    'documentos', coalesce((select jsonb_agg(jsonb_build_object('id', d.id, 'tipo', d.tipo, 'nome', d.nome) order by d.enviado_em)
                              from rh_admissao_doc d where d.admissao_id = a.id), '[]'::jsonb)
  ) into v
  from rh_admissao a
  join organizations o on o.id = a.org_id
  left join org_settings s on s.org_id = a.org_id
  where a.token = p_token and a.status <> 'cancelada';
  return v;
end $$;

create or replace function rh_admissao_marcar_aberta(p_token text)
returns void language sql security definer set search_path to 'public' as $$
  update rh_admissao set aberta_em = coalesce(aberta_em, now()) where token = p_token;
$$;

/** Aceite ou recusa. Vale uma vez: quem já respondeu não muda a resposta pelo link. */
create or replace function rh_admissao_responder(
  p_token text, p_aceita boolean, p_motivo text, p_ip text, p_agente text)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare a rh_admissao;
begin
  select * into a from rh_admissao where token = p_token and status <> 'cancelada';
  if a.id is null then return jsonb_build_object('ok', false, 'erro', 'link'); end if;
  if a.aceita_em is not null or a.recusada_em is not null then
    return jsonb_build_object('ok', false, 'erro', 'respondida');
  end if;
  if a.expira_em is not null and (now() at time zone 'America/Sao_Paulo')::date > a.expira_em then
    return jsonb_build_object('ok', false, 'erro', 'expirada');
  end if;

  update rh_admissao set
    aceita_em   = case when p_aceita then now() end,
    recusada_em = case when p_aceita then null else now() end,
    recusa_motivo = case when p_aceita then null else nullif(p_motivo,'') end,
    aceite_ip = left(coalesce(p_ip, ''), 60), aceite_agente = left(coalesce(p_agente, ''), 300),
    status = case when p_aceita then 'aceita' else 'recusada' end,
    updated_at = now()
  where id = a.id
  returning * into a;

  -- Avisa quem abriu o processo (a caixa de entrada do Flow).
  insert into notifications (user_id, org_id, type, data)
  select a.created_by, a.org_id, 'admissao_resposta',
         jsonb_build_object('nome', a.nome, 'cargo', a.cargo, 'aceitou', p_aceita,
                            'href', '/' || o.slug || '/rh/contratacoes')
    from organizations o where o.id = a.org_id and a.created_by is not null;

  return jsonb_build_object('ok', true, 'aceita', p_aceita);
end $$;

-- Helper interno e funções do link: fechados para os três papéis; só o servidor
-- (flow_auth) executa as do token. DEFAULT PRIVILEGES deste banco dá EXECUTE a
-- anon e authenticated em TODA função nova — por isso o revoke é dos três.
revoke execute on function rh_admissao_por_token(text) from public, anon, authenticated;
revoke execute on function rh_admissao_marcar_aberta(text) from public, anon, authenticated;
revoke execute on function rh_admissao_responder(text, boolean, text, text, text) from public, anon, authenticated;
grant execute on function rh_admissao_por_token(text) to flow_auth;
grant execute on function rh_admissao_marcar_aberta(text) to flow_auth;
grant execute on function rh_admissao_responder(text, boolean, text, text, text) to flow_auth;

notify pgrst, 'reload schema';

-- As quatro de tela rodam com o JWT de quem está logado e se defendem por
-- rh_can; anon nunca precisa delas. ⚠️ Revogar só de `anon` não adianta: função
-- nova também nasce com EXECUTE para PUBLIC, e o anon entra por ali — por isso
-- o revoke é dos dois e o grant de volta é explícito.
revoke execute on function rh_admissao_salvar(uuid, uuid, jsonb) from public, anon;
revoke execute on function rh_admissao_enviar(uuid, text, int) from public, anon;
revoke execute on function rh_admissao_cancelar(uuid, text) from public, anon;
revoke execute on function rh_admissao_limpar_dados(uuid) from public, anon;
grant execute on function rh_admissao_salvar(uuid, uuid, jsonb) to authenticated;
grant execute on function rh_admissao_enviar(uuid, text, int) to authenticated;
grant execute on function rh_admissao_cancelar(uuid, text) to authenticated;
grant execute on function rh_admissao_limpar_dados(uuid) to authenticated;
