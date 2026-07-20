ORG="(select id from organizations where slug='one-a-one')"
for N in $(docker ps --format '{{.Names}}'); do
  HAS=$(docker exec -i "$N" psql -U postgres -d postgres -tAc "select 1 from pg_class where relname='activities' and relkind='r' limit 1" 2>/dev/null)
  if [ "$HAS" = "1" ]; then
    echo ">>> Flow em $N"
    echo '--- Documentos por dono (workspace) x posição na árvore ---'
    docker exec -i "$N" psql -U postgres -d postgres -c "
      select coalesce(w.name,'(ORGANIZAÇÃO / sem cliente)') as dono,
             count(*) as docs,
             count(*) filter (where d.is_folder) as pastas,
             count(*) filter (where d.parent_id is null) as sao_raiz,
             count(*) filter (where d.parent_id is not null) as dentro_de_pasta,
             count(*) filter (where d.archived) as arquivados
      from documents d left join workspaces w on w.id = d.workspace_id
      where d.org_id = $ORG
      group by 1 order by 2 desc;"

    echo '--- INCONSISTÊNCIA: doc cujo dono difere do dono da pasta pai ---'
    docker exec -i "$N" psql -U postgres -d postgres -c "
      select left(d.title,28) as doc, coalesce(wd.name,'(org)') as dono_do_doc,
             left(p.title,24) as pasta_pai, coalesce(wp.name,'(org)') as dono_da_pasta
      from documents d
      join documents p on p.id = d.parent_id
      left join workspaces wd on wd.id = d.workspace_id
      left join workspaces wp on wp.id = p.workspace_id
      where d.org_id = $ORG and d.workspace_id is distinct from p.workspace_id
      limit 20;"

    echo '--- Pastas de topo em ORGANIZAÇÃO que têm nome de cliente (candidatas a mover) ---'
    docker exec -i "$N" psql -U postgres -d postgres -c "
      select left(d.title,26) as pasta, w.name as cliente_com_mesmo_nome,
             (select count(*) from documents c where c.parent_id = d.id) as itens_dentro
      from documents d
      join workspaces w on lower(unaccent(w.name)) = lower(unaccent(d.title)) and w.org_id = $ORG
      where d.org_id = $ORG and d.is_folder and d.parent_id is null and d.workspace_id is null
      order by 1;"
  fi
done
