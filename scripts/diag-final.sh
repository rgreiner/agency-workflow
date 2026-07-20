# 1. achar o container do app do Flow (env aponta pra flow-api)
APP=""
for N in $(docker ps --format '{{.Names}}'); do
  if docker inspect -f '{{range .Config.Env}}{{println .}}{{end}}' "$N" 2>/dev/null | grep -q 'flow-api.oneaone.com.br'; then APP="$N"; break; fi
done
echo "APP do Flow: ${APP:-NAO ENCONTRADO}"

# 2. reiniciar o PostgREST do Flow e esperar subir
echo "reiniciando PostgREST do Flow (gz90)..."
docker restart gz90xurjbewjszbdwcpk06y7-233249732442 >/dev/null
sleep 5

# 3. testar PostgREST DIRETO (bypass RLS via service key) de dentro do app
if [ -n "$APP" ]; then
  URL=$(docker inspect -f '{{range .Config.Env}}{{println .}}{{end}}' "$APP" | grep -iE '^(NEXT_PUBLIC_SUPABASE_URL|SUPABASE_URL)=' | head -1 | cut -d= -f2-)
  KEY=$(docker inspect -f '{{range .Config.Env}}{{println .}}{{end}}' "$APP" | grep -iE 'SERVICE_ROLE_KEY=|SUPABASE_SERVICE_KEY=|SERVICE_KEY=' | head -1 | cut -d= -f2-)
  echo "URL=$URL  (service key: ${KEY:+presente}${KEY:-AUSENTE})"
  echo "-- documentos via PostgREST direto (service role, ignora RLS): --"
  docker exec "$APP" node -e "fetch(process.argv[1]+'/rest/v1/documents?select=id,archived&limit=3',{headers:{apikey:process.argv[2],Authorization:'Bearer '+process.argv[2]}}).then(r=>r.text()).then(t=>console.log('RESP:', t.slice(0,600))).catch(e=>console.log('ERR', e.message))" "$URL" "$KEY" 2>&1
fi

# 4. logs do PostgREST
echo "-- logs gz90 (10 últimas) --"
docker logs --tail 10 gz90xurjbewjszbdwcpk06y7-233249732442 2>&1
