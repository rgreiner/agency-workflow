DB=j14j0o0lmmk20mbcya17dgnd
echo "== aliases de rede do banco do Flow (hostnames pelos quais é acessado) =="
docker inspect -f '{{range $n,$c := .NetworkSettings.Networks}}{{range $c.Aliases}}{{.}} {{end}}{{end}}' "$DB"
echo
echo "== POSTGRES_DB / POSTGRES_USER do banco do Flow =="
docker inspect -f '{{range .Config.Env}}{{println .}}{{end}}' "$DB" | grep -E '^POSTGRES_(DB|USER)='
echo
for P in gz90xurjbewjszbdwcpk06y7-233249732442 y5es7kt2hru90syvwpx2w91e-174432130015; do
  echo "== $P → PGRST_DB_URI (senha mascarada) =="
  docker inspect -f '{{range .Config.Env}}{{println .}}{{end}}' "$P" | grep -iE '^PGRST_DB_URI=' | sed -E 's#://([^:]+):[^@]+@#://\1:***@#'
done
