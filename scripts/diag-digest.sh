DB=j14j0o0lmmk20mbcya17dgnd
docker exec -i "$DB" psql -U postgres -d postgres <<'SQL'
\echo == 1. tarefas atribuidas, ativas, com prazo (base do digest) ==
select count(*) from activity_assignees aa
  join activities a on a.id = aa.activity_id
 where a.archived = false and a.status <> 'concluido' and a.due_date is not null;

\echo == 2. dentro da janela (<= hoje+7, inclui atrasadas) ==
select count(*) from activity_assignees aa
  join activities a on a.id = aa.activity_id
 where a.archived = false and a.status <> 'concluido' and a.due_date is not null
   and a.due_date <= ((now() at time zone 'America/Sao_Paulo')::date + 7);

\echo == 3. profiles com email preenchido / nulo ==
select count(*) filter (where email is not null) as com_email,
       count(*) filter (where email is null)     as sem_email
  from profiles;

\echo == 4. quantos assignees distintos tem email? ==
select count(distinct aa.user_id) as assignees,
       count(distinct aa.user_id) filter (where p.email is not null) as com_email
  from activity_assignees aa
  join activities a on a.id = aa.activity_id
  join profiles p on p.id = aa.user_id
 where a.archived = false and a.status <> 'concluido' and a.due_date is not null;

\echo == 5. digest_payload() cru (tamanho do array) ==
select jsonb_array_length(digest_payload()) as pessoas;
SQL
