# Flow — Análise de lacunas & plano de implantação

> Documento vivo. Gerado em 05/07/2026 a partir de uma varredura completa do código
> (rotas, tabelas, actions, RPCs). Atualizar conforme as ondas forem sendo entregues.
> Números de migration são ilustrativos — usar sempre o próximo livre (hoje: **091**).
> Última atualização: **11/07/2026** (livro-caixa unificado — ver 4.0).

## 0. A fotografia atual (o que JÁ existe — não reconstruir)

- **Pauta**: workspaces (clientes com dados cadastrais completos) → campanhas → atividades
  (prioridade, complexidade, horas estimadas, datas, recorrência, gates de revisão por IA,
  pastas de Drive automáticas). Views: **Lista**, **Gantt simples**, **Atendimento (por cargo)**,
  **Dashboard pessoal**.
- **Colaboração**: comentários com @menção e reações, notificações in-app (sino/inbox),
  silenciar tarefa, chat 1:1 com presença, docs colaborativos (TipTap) com pastas e
  compartilhamento, quadros visuais, to-do pessoal.
- **Comercial/Financeiro**: mídias (5 tipos, com faturamento → lançamento de comissão),
  produção (orçamento/pedido/proposta/fee), lançamentos, contas, categorias, fluxo de caixa,
  import de extrato Conta Azul, cadastros de veículos/fornecedores, permissão `can_finance`.
  **Lançamentos = livro-caixa unificado** (jul/2026): tabela única por data estilo extrato
  (Situação + saldo corrido projetado, cards clicáveis), import "substitui tudo" (não duplica)
  e unificação Flow + extrato importado com **promover ao editar** (ver 4.0).
- **Admin**: membros/papéis/cargos (status permitidos por cargo), aparência (logo, accent,
  cores de status), **Erros do sistema** (log de falhas de 2º plano) e **Verificações**
  (checks de consistência com correção in-loco).
- **Pauta ágil (já feito, não repropor)**: busca global **Ctrl+K** (`CommandPalette`, com
  toggle de arquivadas), **mudanças em lote** na Lista (checkbox + barra flutuante: status,
  responsável, prazo, arquivar), edição inline, colunas configuráveis por usuário.
- **Dados que já existem mas não têm UI**: `activity_history` + `activity_field_history`
  (auditoria completa de status e campos).

## 1. As cinco cegueiras (o que a análise revelou)

O sistema é forte na **execução interna** e fraco em cinco dimensões, em ordem de impacto:

1. **O cliente não está no sistema.** Os status `pendente_cliente` e `aprovacao_cliente`
   existem, mas a aprovação real acontece fora (WhatsApp/e-mail), sem rastro. É o maior
   gargalo de qualquer agência — e a lacuna mais valiosa a fechar.
2. **Não há visão de gestão.** Todas as views são "meu trabalho"; nenhuma responde
   "quem está sobrecarregado? o que está atrasado? onde os jobs empacam? esse cliente dá lucro?"
3. **O trabalho repetido é redigitado.** Agência é padrão: todo mês tem pauta de social,
   toda campanha tem as mesmas 8 etapas. Não há templates nem checklists.
4. **Notificação só alcança quem está com o app aberto.** Tudo é sino in-app; não existe
   digest por e-mail nem lembrete de prazo. Prazo estourado só é visto por acaso.
5. **Não existe executor de agendados.** Tudo roda em `after()` (pós-resposta HTTP).
   Digest, lembretes, contratos recorrentes, sync BTG — nada disso é possível sem um cron.
   É a fundação de meia dúzia de features abaixo.

---

## ONDA 0 — Fundação (pré-requisito de quase tudo)

### 0.1 Executor de tarefas agendadas (cron) — esforço P

**Por quê:** digest (D1), lembretes de prazo (D1), contratos recorrentes (E2), cobrança (E3)
e sync BTG (E1) precisam de execução periódica. O `after()` não serve (só roda pós-request).

**Como:** rota interna + crontab do VPS (sem dependência nova, sem fila).

1. Criar `src/app/api/cron/route.ts` (GET): valida header `x-cron-secret` contra env
   `CRON_SECRET`; roda uma lista de jobs registrados (`src/lib/cron/jobs.ts`, mesmo padrão
   extensível de `lib/health/checks.ts`); cada job em try/catch com `logSystemError`
   (contexto `cron:<job>`). Responder JSON `{ job: ok|erro }`.
2. Aceitar `?job=nome` pra rodar um job isolado (debug manual via curl).
3. Env `CRON_SECRET` no Coolify (Save All Env ANTES do Deploy) + crontab no VPS:
   `*/15 * * * * curl -s -H "x-cron-secret: $SECRET" https://flow.oneaone.com.br/api/cron`.
   Cada job decide internamente sua janela (ex.: digest só às 8h, guardando "última execução"
   numa tabela `cron_runs (job, last_run_at)` — migration 081, idempotente).
4. Health check novo em `lib/health/checks.ts`: "cron sem execução há +1h" (lê `cron_runs`).

### 0.2 Infra de e-mail de notificação — esforço P

**Por quê:** hoje o Resend só manda convite e reset. Digest, aprovação e cobrança precisam
de um template base e de um remetente organizado.

1. `src/lib/email/layout.ts`: função que envelopa qualquer corpo no template já usado no
   convite (header laranja, footer) — extrair o HTML duplicado de `actions/email.ts`.
2. `src/lib/email/send.ts`: `sendMail({to, subject, html, context})` — chama Resend,
   loga falha em `system_errors` com o `context` recebido. Todo e-mail novo passa por aqui.
3. Preferência por usuário (tabela `user_prefs` — migration 082: `user_id, digest_enabled
   boolean default true, digest_hour int default 8`): quem não quer, desliga no perfil.

---

## ONDA 1 — Vitórias rápidas na pauta (1 semana no total)

### 1.1 Estender o Ctrl+K existente — esforço P

O `CommandPalette` já busca tarefas; falta ampliá-lo pra ser O ponto de partida do app.

1. Incluir **docs, mídias e produção** na busca (nova RPC `search_all`, **1 assinatura**,
   devolvendo tipo+título+rota de cada hit).
2. Atalhos fixos de navegação no palette vazio (Inbox, Lista, Gantt, clientes recentes).

### 1.2 Filtros salvos nas views — esforço P

Padrão já definido nas preferências do projeto: um multi-select por dimensão + presets.

1. Nas views Lista/Atendimento/Gantt: multi-select por **cliente, status, responsável,
   prioridade** + filtro rápido **"Eu"**.
2. Presets no `localStorage` (chave versionada `flow:filters:v1:<view>`): chips com
   aplicar/limpar/excluir + botão "salvar filtro atual".
3. Reusar o mesmo componente nas três views (um `FilterBar` só).

### 1.3 Dois débitos do backlog antigo que esta análise reforça — esforço P+M

1. **"Saiba sobre o cliente / sobre a campanha" na tarefa** (backlog de 17/06, aberto):
   link no modal da tarefa levando ao briefing/contexto geral do cliente e da campanha.
   Com os docs colaborativos já existentes, a forma natural é um campo "doc de contexto"
   em `workspaces` e `campaigns` (migration: 2 colunas `context_doc_id`) apontando pra um
   doc — e o link na tarefa abre esse doc. Barato e resolve o "quem chega numa tarefa fria".
2. **Preferências por CONTA em vez de por dispositivo** (backlog aberto): colunas da Lista
   e filtros salvos hoje ficam no localStorage. Migration: tabela `user_view_prefs
   (user_id, org_id, view, prefs jsonb)` + RPC `set_user_view_prefs`; carregar no
   `UserPrefsProvider` existente com fallback pro localStorage (migração transparente).
   Fazer JUNTO com o 1.2 pra já nascer sincronizado.

### 1.4 Checklist dentro da tarefa — esforço M

O trabalho real de uma tarefa quase sempre tem sub-passos ("3 posts", "2 variações").
Subtarefa completa é peso demais; checklist resolve 90%.

1. Migration 084: `activity_checklist_items (id, activity_id, content, done, done_by,
   done_at, ordem)` + RPCs `add/toggle/remove/reorder_checklist_item` (1 assinatura cada)
   + RLS pela org da atividade.
2. UI no modal da atividade: seção "Checklist" acima dos comentários; adicionar com Enter,
   arrastar pra ordenar, riscar ao concluir (com avatar de quem concluiu).
3. Chip de progresso `3/7` na Lista e no Gantt (query agregada junto do `activity-list.ts`).
4. Registrar toggle no `activity_field_history` (campo `checklist`) pra auditoria.

---

## ONDA 2 — O cliente entra no sistema ⭐ (a onda mais valiosa)

### 2.1 Aprovação de peça por link público — esforço G

**Por quê:** é O gargalo de agência. Hoje a peça vai por WhatsApp, a resposta se perde, e o
status `aprovacao_cliente` é atualizado na mão. Com link público: rastro, data, comentário
do cliente e mudança de status automática. É também a feature que mais valida o caminho SaaS.

**Fluxo:** tarefa em `aprovacao_cliente` → botão "Enviar para aprovação" → escolhe as peças
(da pasta Preview/Final do Drive) e escreve mensagem → sistema gera link tokenizado e manda
e-mail ao contato do cliente → cliente abre (sem login), vê as peças, **Aprovar** ou
**Pedir ajustes** (comentário obrigatório) → tarefa avança ou volta, com comentário automático
e notificação ao responsável.

1. Migration 085: `approval_requests (id, org_id, activity_id, token unique, title, message,
   assets jsonb, status pendente|aprovado|ajustes, client_name, client_comment, responded_at,
   expires_at, created_by, created_at)`. RPCs security definer: `get_approval_by_token`
   (anon; não expõe nada além do necessário) e `respond_approval(p_token, p_status,
   p_client_name, p_comment)` (anon; só se `pendente` e não expirado — respostas são únicas).
2. **Peças**: o Drive não é público. Criar rota `src/app/api/aprovacao/[token]/asset/[idx]/route.ts`
   que valida o token e **streama o arquivo do Drive com a service account** (nunca expor
   link direto do Drive). Cachear com `Cache-Control` curto.
3. Rota pública `src/app/aprovacao/[token]/page.tsx` (fora do `(app)`): **força tema claro**,
   mostra logo da org, peças em galeria, mensagem, botões Aprovar (verde) / Pedir ajustes
   (abre textarea). Mobile-first — cliente abre no celular.
4. Ao responder (via RPC): atualiza request → adiciona comentário na tarefa ("✅ Cliente
   aprovou" / "✏️ Cliente pediu ajustes: …") → muda status (aprovado → próximo status;
   ajustes → volta pro status configurado) → notifica responsável + criador.
5. Envio: action `sendApprovalEmail` usando a infra 0.2, destinatário = `contact_name`/
   `finance_email` do workspace (editável no envio). Falha → `system_errors` (`email:aprovacao`).
6. No modal da tarefa: seção "Aprovações" com histórico (quem enviou, quando, resposta).
7. Health check novo: "tarefas paradas em aprovacao_cliente há +N dias sem request ativo".

### 2.2 Digest diário + lembretes de prazo por e-mail — esforço M (depende de 0.1 + 0.2)

1. Job `digest` no cron (janela: `digest_hour` de cada usuário, default 8h): e-mail por
   usuário com **vence hoje / vence amanhã / atrasadas / aguardando você** (tarefas em status
   do seu cargo sem responsável) **/ menções não lidas**. Nada pra mostrar → não envia.
2. Job `lembrete-prazo`: tarefa com `due_date` amanhã e ainda não concluída → notificação
   in-app pro responsável (tipo novo `due_soon`) além do digest.
3. Link de cada item usa o atalho `/j/[activityId]`.
4. Opt-out no perfil (user_prefs da 0.2). Log de falha: `system_errors` (`cron:digest`).

---

## ONDA 3 — A gestão enxerga a operação

### 3.1 Dashboard gerencial — esforço M

Rota `/views/gestao` (owner/admin/manager). Tudo com dados que já existem.

1. **Cards de alerta**: atrasadas · vencem em 7 dias · sem responsável · sem prazo ·
   **paradas há +7 dias no mesmo status** (via `activity_history`: última mudança).
2. **Carga por pessoa**: tarefas ativas e Σ `estimated_hours` por responsável (barra
   horizontal; clicar filtra a Lista). Expõe sobrecarga na hora.
3. **Funil por status**: contagem por status na ordem do fluxo — onde a pauta empaca.
4. Filtro por cliente + período; mesmas cores de status da config da org (nunca fixas).
5. Implementação: 1 RPC agregadora `dashboard_gestao(p_user_id, p_org_id, p_ws uuid[])`
   devolvendo um JSON só (evita 6 round-trips do PostgREST).
6. `router.refresh()` periódico (padrão do app) pra refletir mudanças dos outros.

### 3.2 Templates de tarefa e campanha — esforço G

1. Migration 086: `activity_templates (id, org_id, name, title_pattern, description,
   status_inicial, priority, complexity, estimated_hours, checklist jsonb, offset_dias int)`
   e `campaign_templates (id, org_id, name, description, items jsonb)` — items = lista de
   activity_templates com offsets relativos ao início da campanha (D+0 briefing, D+3 redação…).
2. RPCs: `create_campaign_from_template(p_user_id, p_workspace_id, p_template_id, p_name,
   p_start_date)` — cria campanha + todas as atividades com datas calculadas + checklists;
   `create_activity_from_template` para tarefa avulsa.
3. UI: aba **Templates** em settings (admin cria/edita); em "Nova campanha" e "Nova tarefa",
   opção "a partir de template". Botão "Salvar como template" numa campanha existente
   (engenharia reversa — jeito mais natural de criar o primeiro template).
4. Drive: o provisionamento em lote de pastas já existe (`provisionActivitiesDrive`) — reusar.

### 3.3 Linha do tempo de auditoria (UI sobre dados existentes) — esforço P

`activity_history` + `activity_field_history` já gravam tudo; ninguém vê.

1. Aba "Histórico" no modal da tarefa: linha do tempo unificada (status + campos + quem/quando),
   agrupada por dia. Sem migration — só query e componente.
2. (Opcional, depois) `/settings/auditoria`: últimos N eventos da org filtráveis por pessoa —
   útil pra "quem mudou o prazo?".

---

## ONDA 4 — Tempo e dinheiro (rentabilidade)

### 4.0 Lançamentos = livro-caixa unificado (fluxo de caixa oficial) — EM ANDAMENTO

**Visão (Rafael):** a tela `/financeiro/lancamentos` é O fluxo de caixa. **A pagar** vem do
cadastro manual de custos; **a receber** vem do faturamento (Fee/Pedido/Mídia). O
`extrato_importado` (import Conta Azul) é **histórico transitório** — hoje ele importa o que
ainda não foi migrado pra não perder histórico. Quando a tela estiver 100% + acesso do
contador, ele **desliga o Conta Azul** e tudo passa a ser gerado no Flow.

**Feito (jul/2026):**
- **Redesenho estilo extrato**: tabela única por data com **Situação** (badge) e **Saldo
  corrido projetado** (substituiu os 3 grupos por status). **Cards de resumo clicáveis** viram
  filtro (Receitas/Despesas × aberto/realizado; "Resultado" = tudo).
- **Import "substitui tudo"** (snapshot): cada import apaga e recarrega o extrato completo →
  não duplica mesmo quando situação/saldo mudam entre exports; reflete baixas e exclusões.
  `import_ref` = chave **estável** (campos imutáveis + contador de ocorrência), pré-requisito
  da promoção. Sem migration (reusa `clear_extrato`).
- **Unificação + promover ao editar** (migration 090): a tela mostra Flow + extrato importado
  (selo "Conta Azul", em leitura). Ao **editar** uma linha importada ela vira lançamento do
  Flow (`origem_tipo='conta_azul'`, `origem_ref=import_ref`) e **some do espelho** — não volta
  ao reimportar. RPC `promover_extrato` + coluna `lancamentos.origem_ref`.
- **Fee**: propõe data final (+1 ano) ao escolher o início; Observação pré-carrega o texto
  padrão de Config→Documentos (editável). **Select/MultiSelect**: busca por digitação em
  listas grandes; scroll no dropdown não fecha mais o campo.

**Falta (pra desligar o Conta Azul):**
- **Acesso do contador**: papel/permissão **read-only** no financeiro + **export** (CSV/planilha).
- **Migração final com data de corte**: trazer o histórico do `extrato_importado` pra
  `lancamentos` de uma vez (ou seguir promovendo incremental) e **parar de depender do import**.
  Resolve a limitação da chave estável (2 transações idênticas em
  venc_orig+valor_orig+competência+contato+descrição colidem — raro; o corte elimina).
- **Saldo inicial do mês** (hoje o saldo corrido começa em 0 dentro do mês) e **ordenação por
  coluna** — melhorias de UX pendentes.
- Encaixa direto com **4.2** (contratos/fee recorrente), **4.4** (DRE previsto×realizado) e
  **5.1** (conciliação BTG — mesma tabela `extrato_importado`).

### 4.1 Apontamento de horas leve — esforço G

**Cuidado deliberado:** timesheet burocrático mata a adesão. Versão leve: timer opcional +
lançamento manual rápido, e o relatório certo.

1. Migration 087: `time_entries (id, org_id, activity_id, user_id, minutes, note, data,
   created_at)` + RPCs `add/update/delete_time_entry`. Custo/hora opcional por pessoa
   (`org_members.hourly_cost numeric null`, visível só pra owner/admin).
2. UI no modal da tarefa: botão ▶ inicia timer (estado no localStorage, sobrevive a reload);
   ⏹ pré-preenche o lançamento (minutos arredondados, nota). Entrada manual: "45m reunião".
3. Total apontado vs `estimated_hours` na tarefa (barra discreta).
4. Relatório `/views/horas` (permissionado): horas por cliente/pessoa/período; com custo/hora
   preenchido, **custo real por cliente** — a base pra precificar fee. Export CSV simples.
5. Digest semanal (job no cron) pro admin: horas da semana por pessoa (quem não apontou nada).

### 4.2 Contratos / fee recorrente — esforço M (depende de 0.1)

1. Migration 088: `contratos (id, org_id, workspace_id, descricao, valor_mensal,
   dia_vencimento, inicio, fim, reajuste_pct, ativo)`.
2. Job `contratos` no cron (1×/dia): pra cada contrato ativo, se o lançamento do mês ainda
   não existe, gera `lancamento` (origem `contrato`) com vencimento no `dia_vencimento`.
   Idempotente por (contrato, competência).
3. UI em `/financeiro/contratos`: CRUD + histórico de lançamentos gerados. Encaixa no fluxo
   Fee→Lançamentos já planejado no backlog.

### 4.3 Cobrança: lembrete de vencimento — esforço P (depende de 0.1 + 0.2)

1. Job `cobranca`: lançamentos de **entrada** `em_aberto` vencendo em D-3, D0 e D+3 →
   e-mail pro `finance_email` do workspace (dados do lançamento + dados bancários da org —
   novo campo em `org_settings.payment_info text`).
2. Log por envio (não repetir o mesmo aviso: tabela `cobranca_avisos (lancamento_id, tipo)`)
   e falhas em `system_errors` (`cron:cobranca`).
3. Flag por workspace `cobranca_auto boolean` (nem todo cliente deve receber automático).

### 4.4 DRE simplificado (previsto × realizado) — esforço M

Já parcialmente planejado no backlog do financeiro. Categorias + lançamentos já existem.

1. View mensal: linhas = categorias (receita/despesa), colunas = meses; previsto (lançamentos
   `em_aberto` por vencimento) × realizado (`recebido/pago` por data). Margem no rodapé.
2. Sem migration se as categorias derem conta; senão, campo `grupo_dre` em `categorias`.
3. Rota `/financeiro/dre`, permissão `can_finance`, export CSV.

---

## ONDA 5 — Integrações (encadeia com o backlog existente)

### 5.1 Conciliação BTG — esforço G (já no backlog; situar aqui na sequência)

1. Módulo `src/lib/btg/client.ts` (OAuth2 client credentials do app de dev já criado;
   tokens em env; **conexão lazy**, nunca no import).
2. Job `btg-sync` no cron (1×/dia): busca extrato → upsert em `extrato_importado`
   (dedupe por id da transação). Falha → `system_errors` (`btg:sync`).
3. Matching heurístico extrato ↔ lançamentos (valor exato + data ±2 dias + contato);
   tela `/financeiro/conciliar`: sugestões com aceitar/ignorar/vincular manual.
4. Health check: "lançamentos recebidos sem linha de extrato vinculada há +7 dias" e
   "linhas de extrato sem lançamento" — encaixa direto no framework de Verificações.

### 5.2 Relatório mensal do cliente (link público) — esforço M

O que a agência manda todo mês, gerado em 1 clique.

1. Migration 089: `report_links (id, org_id, workspace_id, competencia, token, created_by)`.
2. Rota pública `/relatorio/[token]`: tema claro forçado, logo da org; seções: atividades
   concluídas no mês (por campanha), mídias veiculadas (com valores opcionais), próximos
   passos (tarefas planejadas). Print-friendly (o cliente vira PDF se quiser).
3. Botão "Gerar relatório do mês" no workspace; regenerar substitui o snapshot.

### 5.3 WhatsApp (avaliar — não construir ainda)

O wpp-helper já existe como base. Usos óbvios: aviso de aprovação pendente pro cliente
(2.1) e lembrete de prazo interno. **Decidir depois** que a aprovação por e-mail rodar:
se o cliente não abre e-mail, o WhatsApp vira a entrega; se abre, não vale a manutenção.

---

## O QUE FICA DE FORA (decisão consciente, não esquecimento)

| Feature | Por que não |
|---|---|
| **Dependências entre tarefas** | Time pequeno + Gantt simples resolvem; cascata de replanejamento é complexidade alta pra ganho baixo aqui. Reavaliar se a equipe crescer. |
| **Portal do cliente completo** | Só depois que a aprovação (2.1) e o relatório (5.2) validarem que o cliente usa link. Portal sem uso é manutenção pura. |
| **OKR/metas** | Peso de processo que não cabe no tamanho do time. |
| **Webhooks/Zapier, Slack, SSO/SAML** | Só fazem sentido na hipótese SaaS com clientes externos pedindo. |
| **Kanban** | As views atuais (Lista por status + Atendimento por cargo) cobrem o fluxo; adicionar board é redundância de manutenção. Reavaliar por demanda real. |
| **NFS-e (emissão)** | Não construir emissão própria. Se a dor apertar, integrar provedor (Focus NFe/eNotas) — decidir com o contador primeiro. |
| **iCal/Google Calendar** | Barato (P) mas de valor incerto; o digest (2.2) provavelmente mata a dor. Fazer só se depois do digest ainda fizer falta. |
| **App mobile** | O app já é responsivo; PWA (manifest + ícone) é 1h de trabalho e resolve "ter na home do celular". Nada além disso por ora. |

---

## ROADMAP RESUMIDO (sequência e dependências)

| Onda | Entregas | Esforço somado | Depende de |
|---|---|---|---|
| **0 — Fundação** | Cron executor · infra de e-mail · user_prefs | ~2 dias | — |
| **1 — Pauta ágil** | Ctrl+K ampliado · filtros salvos · prefs por conta · contexto cliente/campanha · checklist | ~1 semana | — |
| **2 — Cliente ⭐** | Aprovação por link público · digest+lembretes | ~2 semanas | Onda 0 |
| **3 — Gestão** | Dashboard gerencial · templates · auditoria UI | ~2 semanas | — |
| **4 — Tempo e dinheiro** | ✅ livro-caixa unificado (4.0, em andamento) · Horas · contratos · cobrança · DRE | ~2–3 semanas | Onda 0 |
| **5 — Integrações** | BTG · relatório do cliente · (WhatsApp?) | ~2–3 semanas | Ondas 0 e 4 |

Ordem recomendada: **0 → 1 → 2 → 3 → 4 → 5**. As ondas 1 e 3 não dependem de nada e podem
ser intercaladas com o trabalho do financeiro em andamento. A onda 2 é a de maior valor por
esforço — priorizá-la assim que a fundação existir.

---

## CHECKLIST PADRÃO DE IMPLANTAÇÃO (toda feature segue isto)

1. Migration `NNN_nome.sql` idempotente (`if not exists` / `create or replace`),
   RPCs com **1 assinatura só**, terminar com `notify pgrst, 'reload schema'`.
2. **Aplicar a migration em produção ANTES do push** (one-liner ssh; achar o container do
   Postgres pelo schema — tem a tabela `activities` — nunca pelo nome).
3. Todo trabalho de 2º plano/cron: try/catch com `logSystemError` (contexto nomeado);
   nunca vazar dump técnico pro usuário.
4. Se a feature cria estado que pode divergir (vínculo externo, geração automática):
   adicionar um check em `lib/health/checks.ts` com correção in-loco.
5. UI: componentes próprios (`components/ui/Select`, modais com `mousedown` no clique-fora),
   cores de status via config da org, dark mode via `var(--…)`, toast sonner, trava de
   duplo-clique no submit. Páginas públicas forçam tema claro.
6. `npm run typecheck` + `npm run lint` limpos → commit pequeno em pt-BR com prefixo
   temático → push (= deploy) → **testar em produção** → avisar "pronto para testar".
