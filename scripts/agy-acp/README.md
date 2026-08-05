# `agy-acp` — adaptador ACP local para Antigravity CLI

`agy` (Antigravity CLI) **no habla ACP**. Este script lo traduce: expone ACP por stdio y, por cada
`session/prompt`, lanza un turno headless `agy --print --output-format stream-json`, mapeando su
NDJSON a notificaciones `session/update`.

Es el **motor oficial `agy`** de Control Markets: `AcpBridgeService` lo lanza por defecto con el
mismo Node del backend. No requiere instalación ni build.

| Archivo | Qué es |
|---|---|
| `agy-acp.mjs` | El adaptador. Fork de [`maojindao55/agy-acp`](https://github.com/maojindao55/agy-acp) v0.2.2 (Apache-2.0) + parches `CM-Pn`. |
| `test-agy-acp.mjs` | Suite de conformidad ACP (handshake, tokens, multi-root, cancelación, resume). |

## Correr las pruebas

```bash
pnpm test:agy-acp              # 33 verificaciones contra el adaptador (llama a Antigravity de verdad)
pnpm test:agy-acp -- --quick   # sin cancelación ni resume
pnpm test:agy-bridge           # E2E por AcpBridgeService: los mismos eventos SSE que consume la UI
```

Ambas requieren un `agy` instalado y autenticado en el host.

## Variables de entorno

| Variable | Default | Para qué |
|---|---|---|
| `LOCAL_AGENT_AGY_COMMAND` | `<node> scripts/agy-acp/agy-acp.mjs` | Sustituye el adaptador entero (p. ej. `npx -y agy-acp-bridge@0.2.2`). |
| `LOCAL_AGENT_AGY_MODEL` | — | Modelo por defecto vía `session/set_config_option`. Lo usan los heartbeats autónomos, que no tienen selector. |
| `LOCAL_AGENT_AGY_REASONING_EFFORT` | — | `low` \| `medium` \| `high`. Ídem. |
| `AGY_ACP_AGY_BIN` | autodetectado | Ruta absoluta al binario `agy`. |
| `AGY_ACP_PRINT_TIMEOUT` | `15m` | `--print-timeout` del CLI (el default de `agy` son 5m). |
| `AGY_ACP_NO_SKIP_PERMISSIONS` | — | `1` quita `--dangerously-skip-permissions` (todo se auto-deniega en headless). |
| `AGY_ACP_SANDBOX` | — | `1` añade `--sandbox`. |
| `AGY_ACP_DEBUG` | — | `1` loguea a stderr, incluyendo la línea de comando de cada spawn. |
| `AGY_ACP_STATE_FILE` | `~/.agy-acp-state.json` | Dónde persiste las sesiones. |

## Parches respecto de upstream

- **CM-P1** — `session/prompt` devuelve `usage` (ACP `Usage`) tomado de `result.usage`. Sin esto el
  evento SSE `finish` va sin tokens y se rompen `agentic_heartbeat_runs.usage` y el chip de la UI.
- **CM-P2** — Detección del fallo silencioso: en headless los permisos `ask` se auto-deniegan y `agy`
  igual sale con exit 0 y `status: SUCCESS`. Un turno sin texto pero con errores se reporta como
  `stopReason: refusal` y con un mensaje visible.
- **CM-P3** — Resolución del binario `agy` (escaneo de `PATH` + `~/.local/bin`), porque el backend
  suele arrancar desde un IDE con un `PATH` recortado.
- **CM-P4** — `--print-timeout` alineado con el timeout duro del heartbeat.
- **CM-P5** — Modelo/effort por defecto desde `AGY_ACP_MODEL` / `AGY_ACP_EFFORT`.

## ¿Qué modelo/effort está corriendo?

El adaptador anuncia `configOptions[id=model]` y `[id=effort]`, y **si le pides un valor que no
anuncia conserva el suyo** (el bridge loguea un warning; el turno no falla). Por eso el bridge lee
el `currentValue` resultante y lo manda en el evento SSE `session` como `model` / `reasoningEffort`:
eso es lo que la UI pinta en verde al lado del motor, y lo que queda en `usage.model` de cada turno.

Recordá la regla del CLI: `gemini-*` y `gpt-oss-120b` **exigen** `--effort`; los `claude-*` lo
**rechazan** (por eso el selector de effort desaparece al elegir un Claude).

Documentación completa: `control-markets-wiki/02-references/09-agentic-profile-(borges)/local-agent-antigravity.md`
(§3.1 para modelo/effort, §8 para la próxima iteración).

## Límites estructurales (no los arregla ningún parche)

El modo headless es un canal unidireccional: no existe `session/request_permission` ni delegación
`fs/*`. Con este motor **no hay tarjetas de aprobación ni deny-list del sandbox de NestJS** — `agy`
toca el disco directo. La contención se reduce a `cwd` + `--add-dir`, `--mode plan` y
`permissions.allow` en `~/.gemini/antigravity-cli/settings.json`.
