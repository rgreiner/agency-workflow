DB=j14j0o0lmmk20mbcya17dgnd
echo "== Redes do BANCO do Flow ($DB) =="
docker inspect -f '{{range $k,$v := .NetworkSettings.Networks}}{{$k}}
{{end}}' "$DB"
for P in gz90xurjbewjszbdwcpk06y7-233249732442 y5es7kt2hru90syvwpx2w91e-174432130015; do
  echo "== Redes do PostgREST $P =="
  docker inspect -f '{{range $k,$v := .NetworkSettings.Networks}}{{$k}}
{{end}}' "$P"
done
