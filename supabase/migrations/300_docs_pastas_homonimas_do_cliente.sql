-- ── Documentos: as 8 pastas com o nome do próprio cliente saem ──────────────
--
-- Herança da estrutura antiga (19/09/2026): quando Documentos era uma lista só,
-- a pasta "Comil" separava o cliente. Desde que a árvore agrupa por cliente
-- (commit d212922), a pasta virou um nível repetido: COMIL › Comil › documentos.
-- Decisão do Rafael: os documentos sobem para a raiz do cliente e as pastas saem.
--
-- Ficam as 3 pastas que são subdivisão de verdade: Evolua Capital, Evolua
-- Consultoria (Evolua) e Mel do Malte (IMDM).
--
-- Medido antes: as 8 com visibilidade 'org' (acesso de ninguém muda), nenhuma
-- subpasta dentro, nenhum document_members. 44 itens: 24 ativos + 20 arquivados.
--
-- Duas armadilhas deste banco que o SQL contorna:
--  1. trigger set_updated_at carimba now() em TODO update — mover as 44 linhas
--     faria todas parecerem editadas agora e bagunçaria a lista de Recentes. O
--     trigger fica desligado só dentro da transação (DDL é transacional: se algo
--     falhar, o rollback religa).
--  2. documents.parent_id é ON DELETE CASCADE — apagar pasta com filho apaga o
--     filho. Por isso esvazia antes, e o DELETE só pega pasta que o banco
--     confirma vazia.
--
-- IDs explícitos (o que foi medido e aprovado), não a regra de nome — rodar de
-- novo não acha nada: idempotente.

begin;

alter table documents disable trigger set_updated_at;

update documents set parent_id = null
 where parent_id in (
   '4e2fa00a-9093-4a5b-84ea-857962a720dc',  -- Comil
   '03d91047-daf9-44a8-af0f-e845534d80a0',  -- Di Napoli
   '2ebd93f3-9d5f-4a16-be20-c145156532d8',  -- É o Amor
   'a133248c-8955-471f-81c9-bd074b2f923a',  -- Go On
   '7b072916-d071-4f03-b1d3-371e59f77cef',  -- IMDM
   '3922dfd6-4f60-471c-ab7e-a1a007808332',  -- KSBIG
   '07ef78f0-9577-44b7-b013-3213c69ddd2e',  -- One a One
   'b6145e55-9d07-4559-bae4-0ceea6050814'   -- Ópera
 );

delete from documents f
 where f.is_folder
   and f.id in (
     '4e2fa00a-9093-4a5b-84ea-857962a720dc', '03d91047-daf9-44a8-af0f-e845534d80a0',
     '2ebd93f3-9d5f-4a16-be20-c145156532d8', 'a133248c-8955-471f-81c9-bd074b2f923a',
     '7b072916-d071-4f03-b1d3-371e59f77cef', '3922dfd6-4f60-471c-ab7e-a1a007808332',
     '07ef78f0-9577-44b7-b013-3213c69ddd2e', 'b6145e55-9d07-4559-bae4-0ceea6050814'
   )
   and not exists (select 1 from documents c where c.parent_id = f.id);

alter table documents enable trigger set_updated_at;

commit;

-- ── DESFAZER (se um dia precisar) ────────────────────────────────────────────
-- Recria as 8 pastas com os MESMOS ids e devolve cada documento à sua.
-- org_id b394d731-874e-4d08-8f2d-6158f2741915 (One a One Comunicação).
--
-- begin;
-- alter table documents disable trigger set_updated_at;
-- insert into documents (id, org_id, workspace_id, parent_id, title, visibility, created_by, created_at, updated_at, is_folder, archived) values
--  ('4e2fa00a-9093-4a5b-84ea-857962a720dc','b394d731-874e-4d08-8f2d-6158f2741915','4fff1391-2873-40ae-bc94-4408e73685a6',null,'Comil','org','065d0f7d-ebe0-4b3d-9106-b24302992948','2026-06-27 00:26:56.227864+00','2026-07-17 13:16:18.164908+00',true,false),
--  ('03d91047-daf9-44a8-af0f-e845534d80a0','b394d731-874e-4d08-8f2d-6158f2741915','f6f4778e-c2f7-4cab-9216-140ca99e7b8e',null,'Di Napoli','org','065d0f7d-ebe0-4b3d-9106-b24302992948','2026-06-27 00:26:56.227864+00','2026-07-17 13:16:12.08788+00',true,false),
--  ('2ebd93f3-9d5f-4a16-be20-c145156532d8','b394d731-874e-4d08-8f2d-6158f2741915','0927a0d6-f69f-4cc0-af48-793523e443df',null,'É o Amor','org','92f3cd9c-c385-4cf5-b632-607bf052a622','2026-08-19 11:52:32.396954+00','2026-08-19 11:54:02.666394+00',true,false),
--  ('a133248c-8955-471f-81c9-bd074b2f923a','b394d731-874e-4d08-8f2d-6158f2741915','95268daa-b480-4160-8452-204a7f57dee6',null,'Go On','org','065d0f7d-ebe0-4b3d-9106-b24302992948','2026-06-27 00:26:56.227864+00','2026-07-17 13:16:25.547478+00',true,false),
--  ('7b072916-d071-4f03-b1d3-371e59f77cef','b394d731-874e-4d08-8f2d-6158f2741915','abe21761-8db7-4df5-9373-16c8001caa5b',null,'IMDM','org','92f3cd9c-c385-4cf5-b632-607bf052a622','2026-08-20 16:24:35.588064+00','2026-08-20 16:24:45.809143+00',true,false),
--  ('3922dfd6-4f60-471c-ab7e-a1a007808332','b394d731-874e-4d08-8f2d-6158f2741915','3b2fa306-2d07-4767-a4c3-4c9200f7d0e8',null,'KSBIG','org','065d0f7d-ebe0-4b3d-9106-b24302992948','2026-06-27 00:26:56.227864+00','2026-07-17 13:15:50.231422+00',true,false),
--  ('07ef78f0-9577-44b7-b013-3213c69ddd2e','b394d731-874e-4d08-8f2d-6158f2741915','5260b61f-e806-424d-a594-538d1abb2242',null,'One a One','org','065d0f7d-ebe0-4b3d-9106-b24302992948','2026-06-27 00:26:56.227864+00','2026-08-20 19:59:54.816369+00',true,false),
--  ('b6145e55-9d07-4559-bae4-0ceea6050814','b394d731-874e-4d08-8f2d-6158f2741915','2532e22b-0705-41fd-bf73-a18bee4e0cf7',null,'Ópera','org','065d0f7d-ebe0-4b3d-9106-b24302992948','2026-06-27 00:26:56.227864+00','2026-07-17 13:15:37.71202+00',true,false);
-- update documents set parent_id = '4e2fa00a-9093-4a5b-84ea-857962a720dc' where id in ('cf645dd5-dd22-4a5b-bd29-117d070cc983','b8398110-d91f-4baf-910a-7cccec131b2b','9403b771-ac6b-43e8-a50a-f398c200d632','14ca8aff-549a-47c8-a3c1-a3b23a9c3873','ca3fe1f0-a9a1-43b2-aaa1-14ea33571220','76de0545-84b3-4dcc-9c89-669a35170d6e','e0833546-815a-4e21-a44f-dadb15cd9e66','c8deceda-fba1-4a2d-9d97-d440da64a66a','0274c99c-8bca-4d34-81d7-e4c982c4fb77','75ed966f-aeea-4c50-9c58-b501c17cd23e');
-- update documents set parent_id = '03d91047-daf9-44a8-af0f-e845534d80a0' where id in ('b0874b77-9f0f-428f-b46d-73f60a918de8','016a8a33-c437-4726-9e95-53370c1816ff');
-- update documents set parent_id = '2ebd93f3-9d5f-4a16-be20-c145156532d8' where id in ('c25430df-8d2e-40d0-9a6d-ba4e54f7a84f');
-- update documents set parent_id = 'a133248c-8955-471f-81c9-bd074b2f923a' where id in ('a18b48bc-f06b-47dc-8197-4395d1a02e54','5c2202a3-8ce8-496d-a6e4-cb69e9735ffe');
-- update documents set parent_id = '7b072916-d071-4f03-b1d3-371e59f77cef' where id in ('a4959992-d05a-468b-a8a8-7826bcd42db8');
-- update documents set parent_id = '3922dfd6-4f60-471c-ab7e-a1a007808332' where id in ('814ae2b4-581b-4089-85ff-60f6b3fe8f9e','0a4d8bc6-d70e-46ac-840d-fca463195d8d','2abb3ebb-3e25-4617-8389-d24396f9b59d','9e9bf55e-3720-44a8-ba17-6f2243da0b9b','b853c0fc-f7c5-4b44-9de8-9aefc9a8a522','cdb9c586-2a2c-4475-a97b-65f78c2df7a3','ac7c493a-9b2d-4055-9c2e-651d2727eada','e450fa99-9d4d-482f-b542-cc24baf9b31a','c980e552-bc28-4a36-b031-821f83433da7','1b7e23f9-f8f2-4868-a5d3-e8b8b64b5b02','7f6cc5c0-4df9-4200-b598-69fa4a542a07','7f92d7cd-d9df-481f-993e-2dd4260ed7ae','4df890a6-e3d9-4ce8-a582-508b71512a96','35c4d092-13eb-4937-bc00-6fc16a448303');
-- update documents set parent_id = '07ef78f0-9577-44b7-b013-3213c69ddd2e' where id in ('0e1e7793-5c32-4a65-8a4c-1963971e99c7','adaeed8e-78ab-4643-b425-442f6ebde8dc','46191613-6a98-4bb2-90dc-7624d8217f47','e888c3ee-6039-4889-8863-e3d56b5cd78d','c705fbcb-e564-4ac9-9025-9b9af8af4c05','e4d890c2-dac4-41b1-930d-366d11f84846','3f2fa608-1150-4c12-940d-fb52eadf2004','c26a0f8f-c500-4538-a041-b721cdb50de4','ea0799da-4fc2-4d65-b5ef-0e1318dbbd9c','07f483cc-1f88-433a-84e8-e77e7066b692','79e9a42b-fc0d-494f-89db-0349f2322fcc');
-- update documents set parent_id = 'b6145e55-9d07-4559-bae4-0ceea6050814' where id in ('c52f289c-3c4b-4907-bfec-f073d15e8f16','30cf3435-944d-4ee5-b4a1-f8ce48483e28','1ef7c39a-f782-4672-8005-fc6a2133ac3a');
-- alter table documents enable trigger set_updated_at;
-- commit;
