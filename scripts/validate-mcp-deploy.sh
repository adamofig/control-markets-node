#!/usr/bin/env bash
#
# validate-mcp-deploy.sh — the machine-checkable half of task 26.
#
# Task 26 asks nine questions. Five of them need a human reading an agent's answer in the chat
# (does it cite the document, does it admit what it does not have); those stay manual and live in
# the runbook. The other four — the container, the tunnel, the universal reader and multi-tenant
# isolation — are yes/no facts about a deployment, and this is them.
#
# It runs from the laptop: HTTPS against the public hostname for what a stranger can reach, and
# `ssh <host> docker exec` for what only the inside of the container can answer.
#
#   CM_PAT=cm_pat_… ./scripts/validate-mcp-deploy.sh
#   CM_PAT=… CM_PAT_OTHER_ORG=… CM_FOREIGN_URI=cm://source/<id-de-otra-org> ./scripts/validate-mcp-deploy.sh
#
# Every variable has a default aimed at the homelab; override any of them for another deployment.
set -uo pipefail

CM_BASE="${CM_BASE:-https://local-back.control.markets}"
SSH_HOST="${SSH_HOST:-server1}"
CM_SKILL_URI="${CM_SKILL_URI:-cm://skill/agent-profile-specs:sync}"
CM_PAT="${CM_PAT:-${CONTROL_MARKETS_PAT:-}}"
CM_PAT_OTHER_ORG="${CM_PAT_OTHER_ORG:-}"
CM_FOREIGN_URI="${CM_FOREIGN_URI:-}"
CM_CONTAINER="${CM_CONTAINER:-}"

pass=0; fail=0; skip=0
green=$'\033[32m'; red=$'\033[31m'; yellow=$'\033[33m'; dim=$'\033[2m'; reset=$'\033[0m'

ok()    { pass=$((pass+1)); printf '%s  ✓%s %s\n' "$green" "$reset" "$1"; }
ko()    { fail=$((fail+1)); printf '%s  ✗%s %s\n' "$red" "$reset" "$1"; [ $# -gt 1 ] && printf '%s      %s%s\n' "$dim" "$2" "$reset"; }
warn()  { skip=$((skip+1)); printf '%s  ~%s %s\n' "$yellow" "$reset" "$1"; }
head_() { printf '\n%s── %s%s\n' "$dim" "$1" "$reset"; }
json()  { python3 -c "import json,sys;d=json.load(sys.stdin);print($1)" 2>/dev/null; }

[ -z "$CM_PAT" ] && { echo "Falta CM_PAT (tu token cm_pat_*)." >&2; exit 2; }

printf '%sValidación del despliegue MCP · %s vía %s%s\n' "$dim" "$CM_BASE" "$SSH_HOST" "$reset"

# ---------------------------------------------------------------------------------------------
head_ "1. El backend se declara cableado (GET /api/local-agent/status)"
# Task 23's promise in one call: what the status says here is what `describeRuntime` will put in the
# prompt. If the two disagree, the context is lying to the model and nothing below matters.
status="$(curl -fsS -H "Authorization: Bearer $CM_PAT" "$CM_BASE/api/local-agent/status" 2>/dev/null)"
if [ -z "$status" ]; then
  ko "/api/local-agent/status no respondió" "¿el PAT es válido y el backend está arriba?"
else
  mcp_enabled="$(printf '%s' "$status" | json "d['mcp']['enabled']")"
  mcp_url="$(printf '%s' "$status" | json "d['mcp']['url']")"
  tools="$(printf '%s' "$status" | json "','.join(d['mcp']['toolNames'])")"
  agy_ok="$(printf '%s' "$status" | json "d['engines']['agy']['available']")"
  shim="$(printf '%s' "$status" | json "d['mcp']['agy']['shimExists']")"
  cli="$(printf '%s' "$status" | json "d['mcp']['cmCli']['exists'] and d['mcp']['cmCli']['onPath']")"

  [ "$mcp_enabled" = "True" ] && ok "AGENT_MCP_ENABLED activo" || ko "el cableado MCP está apagado" "AGENT_MCP_ENABLED=$mcp_enabled"
  case "$mcp_url" in
    http://127.0.0.1:*|http://localhost:*) ok "la CLI llamará a loopback ($mcp_url)" ;;
    *) ko "la CLI llamaría a $mcp_url" "una credencial de sesión no debe viajar por Cloudflare — revisá AGENT_MCP_URL" ;;
  esac
  case "$tools" in
    *cm_read*) ok "la sesión promete cm_read (${tools})" ;;
    *) ko "cm_read no está en el catálogo de la sesión" "scopes: revisá AGENT_SESSION_MCP_SCOPES" ;;
  esac
  [ "$agy_ok" = "True" ] && ok "agy disponible en el contenedor" || ko "agy no disponible" "revisá el bind mount /usr/local/bin/agy"
  [ "$shim" = "True" ] && ok "cm-mcp-stdio.mjs presente en la imagen" || ko "falta el shim stdio" "el Dockerfile debe copiar scripts/"
  [ "$cli" = "True" ] && ok "bin/cm existe y está en el PATH" || ko "bin/cm no está en el PATH del contenedor" "Dockerfile: COPY /app/bin + ENV PATH"
fi

# ---------------------------------------------------------------------------------------------
head_ "2. El túnel no regala /mcp (§4 de la tarea)"
# El endpoint responde en loopback por diseño; lo que hay que probar es que desde afuera exija
# credencial. Un 200 acá es la falla que la tarea 25 declaraba bloqueante.
code="$(curl -s -o /dev/null -w '%{http_code}' -X POST "$CM_BASE/mcp" \
  -H 'Content-Type: application/json' -H 'Accept: application/json, text/event-stream' \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}')"
case "$code" in
  401|403) ok "/mcp sin token responde $code" ;;
  200) ko "/mcp sin token responde 200" "el túnel expone las herramientas sin autenticación" ;;
  *) warn "/mcp sin token responde $code (esperado 401)" ;;
esac

code="$(curl -s -o /dev/null -w '%{http_code}' -X POST "$CM_BASE/mcp" \
  -H "Authorization: Bearer $CM_PAT" -H 'Content-Type: application/json' \
  -H 'Accept: application/json, text/event-stream' \
  -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"validate","version":"1"}}}')"
[ "$code" = "200" ] && ok "/mcp con PAT responde 200 al initialize" || ko "/mcp con PAT responde $code" "una credencial humana debería entrar"

# ---------------------------------------------------------------------------------------------
head_ "3. El verbo de lectura, por HTTP (escenarios 1 y 2)"
body="$(curl -s -w '\n%{http_code}' -H "Authorization: Bearer $CM_PAT" \
  --get --data-urlencode "uri=$CM_SKILL_URI" "$CM_BASE/api/cm/resource")"
code="${body##*$'\n'}"; payload="${body%$'\n'*}"
if [ "$code" = "200" ]; then
  chars="$(printf '%s' "$payload" | json "len(d.get('content') or '')")"
  [ "${chars:-0}" -gt 100 ] && ok "$CM_SKILL_URI devolvió $chars caracteres" || ko "$CM_SKILL_URI devolvió contenido vacío"
else
  ko "GET /api/cm/resource → $code" "$CM_SKILL_URI — ¿la skill está sincronizada en esta organización?"
fi

# ---------------------------------------------------------------------------------------------
head_ "4. Aislamiento multi-tenant (escenario 8 — el que debe fallar bien)"
if [ -n "$CM_PAT_OTHER_ORG" ] && [ -n "$CM_FOREIGN_URI" ]; then
  code="$(curl -s -o /dev/null -w '%{http_code}' -H "Authorization: Bearer $CM_PAT_OTHER_ORG" \
    --get --data-urlencode "uri=$CM_FOREIGN_URI" "$CM_BASE/api/cm/resource")"
  case "$code" in
    404) ok "un token de otra organización recibe 404 por $CM_FOREIGN_URI" ;;
    200) ko "FUGA: un token de otra organización leyó $CM_FOREIGN_URI" "esto invalida la V1 entera" ;;
    *) warn "respuesta $code (se esperaba 404)" ;;
  esac
else
  warn "escenario 8 omitido — exportá CM_PAT_OTHER_ORG y CM_FOREIGN_URI"
fi

# ---------------------------------------------------------------------------------------------
head_ "5. Dentro del contenedor (escenario 6 y §4 de infraestructura)"
if ! ssh -o BatchMode=yes -o ConnectTimeout=8 "$SSH_HOST" true 2>/dev/null; then
  warn "sin SSH a $SSH_HOST — omitidas las verificaciones dentro del contenedor"
else
  [ -z "$CM_CONTAINER" ] && CM_CONTAINER="$(ssh "$SSH_HOST" "docker ps --filter 'name=node' --format '{{.ID}} {{.Image}}'" 2>/dev/null | grep -i 'control-markets-node' | head -1 | cut -d' ' -f1)"
  if [ -z "$CM_CONTAINER" ]; then
    ko "no encontré el contenedor del backend en $SSH_HOST" "pasá CM_CONTAINER=<id>"
  else
    ok "contenedor $CM_CONTAINER"

    # El "script universal": la única forma de leer un documento para un motor que tiene shell y no
    # tiene nuestras tools. Debe devolver lo mismo que ve el agente.
    out="$(ssh "$SSH_HOST" "docker exec -e CONTROL_MARKETS_BACKEND_URL=http://127.0.0.1:8121 -e CONTROL_MARKETS_PAT='$CM_PAT' $CM_CONTAINER cm read '$CM_SKILL_URI' 2>/dev/null" | head -c 4000)"
    [ ${#out} -gt 100 ] && ok "\`cm read\` dentro del contenedor devolvió ${#out}+ caracteres" || ko "\`cm read\` no devolvió el documento" "$(printf '%s' "$out" | head -3)"

    # La tesis de la V1: nada de esto se apoya en la wiki en disco.
    if ssh "$SSH_HOST" "docker exec $CM_CONTAINER sh -c 'ls -d /app/control-markets-wiki /app/wiki 2>/dev/null'" 2>/dev/null | grep -q .; then
      ko "hay una wiki dentro de la imagen" "la V1 no probaría lo que dice probar"
    else
      ok "la imagen no contiene la wiki"
    fi

    mounts="$(ssh "$SSH_HOST" "docker inspect --format '{{range .Mounts}}{{.Source}}->{{.Destination}} {{end}}' $CM_CONTAINER" 2>/dev/null)"
    printf '%s      mounts: %s%s\n' "$dim" "$mounts" "$reset"
    extra="$(printf '%s' "$mounts" | tr ' ' '\n' | grep -v '^$' | grep -vE '(/agy->|\.gemini->|\.config->)' | tr '\n' ' ')"
    [ -z "$extra" ] && ok "sin bind mounts nuevos para esta funcionalidad" || warn "montajes fuera de los tres conocidos: $extra"

    cfg="$(ssh "$SSH_HOST" "docker exec $CM_CONTAINER cat /root/.gemini/config/mcp_config.json 2>/dev/null" | tr -d '\n')"
    case "$cfg" in
      *control-markets*) ok "agy tiene registrado el servidor control-markets" ;;
      '') warn "todavía no existe mcp_config.json — se escribe al abrir la primera sesión agy" ;;
      *) warn "mcp_config.json existe sin nuestra entrada — abrí una sesión agy y repetí" ;;
    esac
  fi
fi

printf '\n%s%d OK%s · %s%d fallas%s · %s%d pendientes%s\n' "$green" "$pass" "$reset" "$red" "$fail" "$reset" "$yellow" "$skip" "$reset"
[ "$fail" -eq 0 ]
