# ACP Bridge — Claude (y Gemini) como agente local

## Qué es

El **ACP Bridge** permite que Control Markets ejecute un CLI de agente externo
(Claude Code o Gemini CLI) como motor de chat agéntico, hablándole por el
**Agent Client Protocol (ACP)** — un protocolo JSON-RPC sobre stdin/stdout que
es agnóstico al agente. El backend de NestJS actúa como **cliente ACP**: lanza
el CLI como proceso hijo, le envía prompts y retransmite la respuesta en
streaming (SSE) al frontend, exactamente con la misma unión de eventos que el
harness propio.

> Solo se activa cuando `LOCAL_AGENT_MODE=true`. Es un modo de desarrollo local:
> el agente corre en la máquina del desarrollador con su autenticación personal,
> no en producción.

Código fuente: [`src/local-agent/`](../../../src/local-agent/)
- [`acp-bridge.service.ts`](../../../src/local-agent/acp-bridge.service.ts) — el puente ACP
- [`filesystem-tools.service.ts`](../../../src/local-agent/filesystem-tools.service.ts) — fs sandboxeado + roots
- [`local-agent.controller.ts`](../../../src/local-agent/local-agent.controller.ts) — endpoints HTTP/SSE
- [`local-agent-chat.service.ts`](../../../src/local-agent/local-agent-chat.service.ts) — harness propio (no-ACP)

---

## Motores soportados (`AcpEngine`)

El protocolo es el mismo; solo cambia el comando que se lanza y su config
(`ENGINE_CONFIGS` en `acp-bridge.service.ts`).

| Engine | Comando por defecto | Override (env) | Auth / notas |
| :--- | :--- | :--- | :--- |
| `gemini` | `gemini --acp` | `LOCAL_AGENT_GEMINI_COMMAND` | Usa OAuth personal. Se le **quitan** las env de Vertex (`GOOGLE_CLOUD_PROJECT`, `GOOGLE_APPLICATION_CREDENTIALS`, etc.) porque si están presentes Gemini cambia a Code Assist facturado y falla con `403 IAM_PERMISSION_DENIED`. Soporta `--include-directories`. |
| `claude` | `npx -y @zed-industries/claude-code-acp` | `LOCAL_AGENT_CLAUDE_COMMAND` | Adaptador oficial de Zed que puentea el Claude Agent SDK a ACP (npx lo auto-descarga). Se le **quitan** `CLAUDECODE`, `CLAUDE_CODE_ENTRYPOINT`, `CLAUDE_CODE_SSE_PORT` — si no, el adaptador se niega a arrancar "dentro de otra sesión de Claude Code". No soporta `--include-directories`. |

---

## Configuración (`.env`)

```bash
LOCAL_AGENT_MODE=true
# Roots permitidos para el fs sandboxeado y cwd del CLI. Coma-separados.
# Acepta rutas absolutas, ~ y rutas relativas (se resuelven contra el home).
LOCAL_AGENT_WORKSPACE_ROOTS=~/Documents/GitHub/control-markets,~/Documents/Adamo Main Vault

# Overrides de comando — usar la RUTA ABSOLUTA del ejecutable si el server se
# lanza desde un IDE cuyo PATH no incluye nvm (ver "Errores comunes").
LOCAL_AGENT_CLAUDE_COMMAND=/Users/<user>/.nvm/versions/node/<ver>/bin/npx -y @zed-industries/claude-code-acp
# LOCAL_AGENT_GEMINI_COMMAND=gemini --acp
```

Resolución de roots: `workspaceRoots` expande cada entrada con `expandHome()`
(`filesystem-tools.service.ts`): `~`/`~/...` → home; rutas relativas → unidas al
home; rutas absolutas → tal cual. El **primer root** es el `cwd` con el que se
lanza el CLI.

### Cómo proveer el adaptador `claude-code-acp`

El adaptador **no** es una dependencia del `package.json` — es un agente externo
que el bridge lanza como subproceso. Hay dos formas de proveerlo:

#### Opción A — instalación global + ruta directa a `node` (posiblemente mejor)

> ⚠️ **Sin probar todavía en una Mac/PC real.** Sobre el papel es la opción más
> robusta y reproducible, pero falta validarla end-to-end en una máquina real
> antes de hacerla el camino oficial.

```bash
# Requisito de setup (una vez):
npm i -g @zed-industries/claude-code-acp

# .env — apuntar directo a node + el entry instalado (sin npx, sin descarga):
LOCAL_AGENT_CLAUDE_COMMAND=/Users/<user>/.nvm/versions/node/<ver>/bin/node /Users/<user>/.nvm/versions/node/<ver>/lib/node_modules/@zed-industries/claude-code-acp/dist/index.js
```

Ventajas frente a `npx`:
- **Arranque inmediato** (ya está en disco; no descarga la primera vez).
- **Versión fija y reproducible** — `npx` puede resolver una versión nueva sin
  avisar y romper el bridge; el global la ancla hasta que tú actualices.
- **Evita `spawn npx ENOENT`** y el problema del shebang `env node` cuando el
  server arranca desde un IDE cuyo PATH no incluye nvm (por eso se apunta directo
  a `node`, no al bin `claude-code-acp`, que también es un script con shebang).
- Funciona **offline**.

#### Opción B — `npx -y` (lo que tenemos hoy, default del bridge)

```bash
LOCAL_AGENT_CLAUDE_COMMAND=/Users/<user>/.nvm/versions/node/<ver>/bin/npx -y @zed-industries/claude-code-acp
```

`npx -y` auto-descarga el adaptador a su caché la primera vez. Ventaja: **cero
fricción de setup** para quien clona el repo — funciona sin instalar nada. Es el
default del bridge por eso. Desventajas: versión flotante y los `ENOENT`
descritos en "Errores comunes".

---

## Cómo funciona (flujo de una conversación)

```
Frontend ──POST /local-agent/acp/stream──► Controller
                                               │
                                               ▼
                                       AcpBridgeService.stream(message, sessionId, profileContext, engine)
                                               │
                  ┌────────────────────────────┤
                  ▼                             ▼
        getOrCreateSession()           AsyncEventQueue (buffer SSE)
                  │
                  ▼
        spawn(CLI --acp) ──stdin/stdout(ndjson)──► ClientSideConnection (JSON-RPC)
                  │
        connection.initialize() → newSession()/loadSession()
                  │
        connection.prompt({ sessionId, prompt })
                  │
        notificaciones sessionUpdate ──► mapUpdate() ──► queue.push(event) ──► SSE al frontend
```

1. **Sesión**: `getOrCreateSession` reutiliza la sesión si su proceso sigue vivo
   (`exitCode === null`); si no, lanza el CLI de nuevo conservando el `engine`
   original. Las sesiones tienen id estable propio (`session.id`) independiente
   del id del lado del CLI (`acpSessionId`).
2. **Spawn**: se clona `process.env`, se borran las `stripEnv` del motor, y se
   lanza `spawn(exe, args, { cwd, env })`.
3. **Transporte**: `acp.ndJsonStream` envuelve stdin/stdout del hijo;
   `ClientSideConnection` maneja el JSON-RPC.
4. **Handshake**: `initialize` (con capabilities de fs), luego `loadSession` si
   el CLI lo soporta y ya había un `acpSessionId`, o `newSession` para empezar.
5. **Prompt**: la primera vez se inyecta el `profileContext` como recurso
   `context://agentic-profile` (markdown), una sola vez por sesión
   (`contextSent`). Luego se manda el texto del mensaje.
6. **Streaming**: las notificaciones `sessionUpdate` se traducen en `mapUpdate`
   y se empujan a un `AsyncEventQueue` que el generador `stream()` drena como SSE.

### Mapeo de eventos (`mapUpdate`)

| `sessionUpdate` del CLI | Evento SSE emitido |
| :--- | :--- |
| `agent_message_chunk` (text) | `text-delta` |
| `agent_thought_chunk` (text) | `reasoning-delta` |
| `tool_call` | `tool-call` (registra título en `toolNames`) |
| `tool_call_update` (completed/failed) | `tool-result` (prefijo `FAILED:` si falló) |
| `plan` | `plan` (lista de entries) |
| (otros) | ignorado |

Además el bridge emite: `session` (al inicio, con el id estable),
`permission-request`, `finish` (con `stopReason`) y `error`.

---

## Permisos (human-in-the-loop)

Cuando el CLI pide permiso para una herramienta, llega un
`session/request_permission`. El bridge:
1. Genera un `requestId`, guarda un `PendingPermission` y emite un evento SSE
   `permission-request` con las opciones.
2. Espera la respuesta del usuario vía `POST /local-agent/acp/permission`
   (`respondPermission`) o expira a los `PERMISSION_TIMEOUT_MS` (5 min) → se
   resuelve como `cancelled`.

`POST /local-agent/acp/cancel` cancela el turno en curso (`session/cancel`) y
resuelve cualquier permiso pendiente como cancelado.

---

## Endpoints (`local-agent.controller.ts`)

| Método | Ruta | Función |
| :--- | :--- | :--- |
| `GET` | `/local-agent/status` | Estado del harness propio + `getAcpStatus()` (disponibilidad/versión por motor) |
| `POST` | `/local-agent/stream` | Stream del harness propio (no-ACP) |
| `POST` | `/local-agent/acp/stream` | Stream ACP (body: `message`, `sessionId?`, `engine?`) |
| `POST` | `/local-agent/acp/permission` | Responder a un `permission-request` |
| `POST` | `/local-agent/acp/cancel` | Cancelar turno en curso |

`getAcpStatus` prueba el `versionCommand` de cada motor una vez (cacheado en
`versions`) para reportar `available`/`version`. Mantiene campos planos legacy
(`acpAvailable`, `geminiVersion`) para callers viejos.

---

## Filesystem sandboxeado

`FilesystemToolsService` expone `readTextFile`/`writeTextFile` al CLI vía las
capabilities de ACP, pero `resolveSafe` obliga a que toda ruta:
- caiga dentro de uno de los `workspaceRoots`, y
- no coincida con `DENY_PATTERNS`: `.env`, `node_modules`, `.git/`, `secret`,
  `credential`, `*.pem`, `*.key`.

Límites de lectura: `MAX_READ_BYTES = 100k`, `MAX_READ_LINES = 2000`.

---

## Ciclo de vida de sesiones

- **Reaper**: cada 60 s, `reapIdleSessions` mata (SIGTERM) y elimina sesiones
  sin turno activo e inactivas más de `IDLE_TTL_MS` (15 min).
- **Shutdown**: `onModuleDestroy` limpia el reaper y mata todos los procesos.
- **Salida del CLI**: el handler `exit` empuja un evento `error` y cierra la cola.

---

## Errores comunes

### `Error: spawn npx ENOENT` (tumbaba todo el server)

**Causa**: el motor `claude` lanza `npx -y @zed-industries/claude-code-acp`. Si
el server se arranca desde un IDE (p. ej. Antigravity) cuyo `PATH` no incluye el
bin de nvm, `npx` no se encuentra → ENOENT. `spawn` emite un evento `'error'`
asíncrono; **sin** un listener `'error'`, Node lo trata como excepción no
manejada y mata todo el proceso de NestJS.

**Solución (código)**: hay un handler `child.on('error', ...)` tras el `spawn`
en `acp-bridge.service.ts` que loguea y empuja el error a la cola de la sesión
en vez de crashear. Si es ENOENT añade el hint de configurar `commandEnv` con
ruta absoluta.

**Solución (config)**: poner la ruta absoluta del ejecutable en
`LOCAL_AGENT_CLAUDE_COMMAND` (o `LOCAL_AGENT_GEMINI_COMMAND`):
```bash
LOCAL_AGENT_CLAUDE_COMMAND=/Users/<user>/.nvm/versions/node/<ver>/bin/npx -y @zed-industries/claude-code-acp
```

### `403 IAM_PERMISSION_DENIED` con Gemini
Las env de Vertex (`GOOGLE_CLOUD_*`, `GOOGLE_APPLICATION_CREDENTIALS`) empujan a
Gemini a Code Assist facturado. El bridge ya las quita vía `stripEnv`; si
reaparece, revisa que no se inyecten después del spawn.

### "cannot be launched inside another Claude Code session"
El adaptador de Claude detecta `CLAUDECODE`/`CLAUDE_CODE_*`. El bridge ya las
quita vía `stripEnv`.

### `cwd` no existe → ENOENT engañoso (¡el señuelo más común!)
El primer `LOCAL_AGENT_WORKSPACE_ROOTS` es el `cwd` del CLI. Si apunta a una ruta
inexistente (p. ej. usuario equivocado en la ruta, o un vault que ya no existe),
el spawn falla. Usa `~/...` para que se resuelva contra el home real.

> ⚠️ **Trampa clave**: cuando el `cwd` no existe, Node lanza
> `spawn <ejecutable> ENOENT` **culpando al ejecutable** (`npx`/`node`), aunque
> el ejecutable sí exista. El verdadero problema es el `cwd`. No persigas a `npx`
> ni a `node`: verifica **primero** que el primer workspace root exista en disco
> (`ls -d "$(eval echo <ruta>)"`).
>
> Síntoma típico: el mensaje cambia de `npx` a la ruta absoluta de `node` cada
> vez que tocas `LOCAL_AGENT_CLAUDE_COMMAND`, pero el ENOENT **persiste** — señal
> inequívoca de que el ejecutable no es el problema, sino el `cwd`.
>
> Reproducible: `spawn(node, ['-v'], { cwd: '/no/existe' })` → `spawn <node> ENOENT`.

**Solución**: asegúrate de que el **primer** root exista (usa el repo:
`~/Documents/GitHub/control-markets`) y quita/corrige roots que apunten a rutas
inexistentes. El bridge valida el `cwd` antes del spawn y lanza un error claro
("primer LOCAL_AGENT_WORKSPACE_ROOTS no existe") en vez del ENOENT confuso.

### `node`/`npx` no encuentra a `node` (shebang `env node`)
Si `LOCAL_AGENT_CLAUDE_COMMAND` usa `npx` (un script con shebang
`#!/usr/bin/env node`) y el server se arrancó desde un IDE cuyo `PATH` no incluye
el bin de nvm, el shebang no encuentra `node`. El bridge ya antepone la carpeta
del ejecutable al `PATH` del hijo cuando `exe` es ruta absoluta. Alternativa más
robusta: apuntar directo a `node` + el entry instalado, sin `npx` ni descarga:
```bash
LOCAL_AGENT_CLAUDE_COMMAND=/Users/<user>/.nvm/versions/node/<ver>/bin/node /Users/<user>/.nvm/versions/node/<ver>/lib/node_modules/@zed-industries/claude-code-acp/dist/index.js
```
(requiere `npm i -g @zed-industries/claude-code-acp` con ese mismo node.)

---

## Notas de implementación

- El SDK `@agentclientprotocol/sdk` es **ESM-only**; el proyecto compila a
  CommonJS, así que se carga con `new Function('return import(...)')` para que el
  `import()` dinámico sobreviva la transpilación.
- Un mismo `session.id` sobrevive a respawns del proceso; el `engine` queda fijo
  al de creación, ignorando el solicitado en respawns.
