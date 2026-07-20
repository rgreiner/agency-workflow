ORG="(select id from organizations where slug='one-a-one')"
for N in $(docker ps --format '{{.Names}}'); do
  HAS=$(docker exec -i "$N" psql -U postgres -d postgres -tAc "select 1 from pg_class where relname='activities' and relkind='r' limit 1" 2>/dev/null)
  if [ "$HAS" = "1" ]; then
    echo ">>> Flow em $N"
    echo '--- ATRASADAS por pessoa: hoje vs regra CARGO ---'
    docker exec -i "$N" psql -U postgres -d postgres -c "
    with atr as (
      select a.id, a.status from activities a
      join campaigns c on c.id=a.campaign_id
      join workspaces w on w.id=c.workspace_id
      where w.org_id=$ORG and a.archived=false and a.status::text<>'concluido'
        and a.due_date is not null and a.due_date::date < current_date),
    hoje as (
      select aa.user_id, count(*) n from atr
      join activity_assignees aa on aa.activity_id=atr.id group by aa.user_id),
    cargo as (
      select aa.user_id, count(*) n from atr
      join activity_assignees aa on aa.activity_id=atr.id
      join organization_members om on om.user_id=aa.user_id and om.org_id=$ORG
      join org_positions pos on pos.id=om.position_id
      where atr.status = any(pos.allowed_statuses) group by aa.user_id)
    select left(p.full_name,20) as pessoa, coalesce(pos.name,'(SEM CARGO)') as cargo,
           coalesce(h.n,0) as hoje, coalesce(c.n,0) as pela_regra_cargo,
           coalesce(h.n,0)-coalesce(c.n,0) as some
    from profiles p
    join organization_members om on om.user_id=p.id and om.org_id=$ORG
    left join org_positions pos on pos.id=om.position_id
    left join hoje h on h.user_id=p.id
    left join cargo c on c.user_id=p.id
    where coalesce(h.n,0) > 0
    order by 3 desc;"

    echo '--- Atrasadas que ficariam SEM dono pela regra de cargo ---'
    docker exec -i "$N" psql -U postgres -d postgres -c "
    with atr as (
      select a.id, a.status::text as st from activities a
      join campaigns c on c.id=a.campaign_id
      join workspaces w on w.id=c.workspace_id
      where w.org_id=$ORG and a.archived=false and a.status::text<>'concluido'
        and a.due_date is not null and a.due_date::date < current_date)
    select st as status, count(*) as atrasadas,
      count(*) filter (where exists (
        select 1 from activity_assignees aa
        join organization_members om on om.user_id=aa.user_id and om.org_id=$ORG
        join org_positions pos on pos.id=om.position_id
        where aa.activity_id=atr.id and atr.st::activity_status = any(pos.allowed_statuses))) as com_dono_pelo_cargo
    from atr group by st order by 2 desc;"
  fi
done
