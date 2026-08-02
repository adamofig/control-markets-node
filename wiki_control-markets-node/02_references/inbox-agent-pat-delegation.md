---
title: "Control Inbox — delegación PAT para mensajes de agentes"
status: implemented-v1
updated: 2026-08-01
route: POST /api/inbox/agents/:agenticProfileId/messages
---

# Control Inbox — delegación PAT para mensajes de agentes

## Resultado

Un cliente local puede usar el PAT de un humano para autorizar un mensaje, mientras que la identidad visible y durable se obtiene de la Agent Card vinculada al `AgenticProfile` de la ruta.

La regla de autoridad es:

```text
PAT -> autoriza al usuario
AgenticProfile -> define el ejecutor y la política de delegación
Agent Card -> firma el mensaje y aporta nombre/avatar
```

El PAT nunca se persiste en Inbox. El mensaje conserva por separado quién autorizó, qué perfil ejecutó y qué tarjeta firmó.

## Contrato HTTP

```http
POST /api/inbox/agents/:agenticProfileId/messages
Authorization: Bearer cm_pat_...
X-Org-Id: <organization-id>
Content-Type: application/json
```

```json
{
  "targetUserId": "<user-id>",
  "clientMessageId": "<stable-idempotency-key>",
  "parts": [
    {
      "type": "text",
      "text": "Hola desde el agente",
      "format": "markdown",
      "language": "es"
    }
  ],
  "source": {
    "type": "local",
    "executionId": "optional-run-id",
    "engine": "claude"
  }
}
```

`clientMessageId` es obligatorio, tiene un máximo de 128 caracteres y hace el envío idempotente dentro de la conversación. `parts` acepta de 1 a 20 partes; el texto tiene un máximo de 20 000 caracteres. Para archivos se requiere un `storageAssetId` ya autorizado.

Para PAT, `source.type` sólo admite `rest`, `mcp` o `local`. `heartbeat` y `task_automation` están reservados para ejecuciones internas.

El DTO no contiene `orgId`, `conversationId`, `agentCardId`, `senderParticipantId`, `role`, nombre ni avatar. Propiedades adicionales con esos nombres no se usan como autoridad: el servidor deriva toda la identidad.

## Resolución y validaciones

`InboxAgentController` ejecuta los guards en este orden:

1. `ProjectAuthGuard` valida `Bearer cm_pat_*` o `x-api-key` y resuelve al usuario.
2. `InboxPatDelegationGuard` rechaza Firebase u otras credenciales para esta ruta: la excepción es PAT-only.
3. `InboxIdentityService` valida que el usuario pertenece al `X-Org-Id` solicitado.
4. `InboxAgentIdentityService` carga el perfil con `id + orgId`.
5. Verifica `delegation.pat.enabled` y la presencia del usuario en `allowedUserIds`.
6. Carga la Agent Card vinculada y vuelve a validar `orgId`.
7. Resuelve al destinatario dentro de esa misma organización.

Si cualquier frontera falla se responde `401`, `403` o `404` antes de crear un mensaje.

## Conversación, membresías y mensaje

`InboxConversationService.getOrCreateAgent()` usa:

```text
type: agent
dedupeKey: agent:<agentCardId>:user:<targetUserId>
agentContext.agenticProfileId: <profileId>
agentContext.agentCardId: <cardId>
```

Participantes:

- `agent:<agentCardId>`, tipo `agent_card`, con snapshot de nombre y avatar;
- `user:<targetUserId>`, tipo `user`.

La membresía del agente tiene rol `agent`; la del humano, rol `member`. El mensaje queda con `senderParticipantId: agent:<agentCardId>`, `role: assistant`, `kind: message` y `status: sent`.

El envío reutiliza `InboxMessageService`, por lo que conserva secuencia atómica, idempotencia, unread, resumen de conversación y el evento SSE `inbox.message.created`.

## Procedencia persistida

```json
{
  "provenance": {
    "authType": "pat_delegation",
    "authenticatedUserId": "<human-user-id>",
    "agenticProfileId": "<profile-id>",
    "agentCardId": "<card-id>",
    "source": "local",
    "executionId": "<optional-run-id>",
    "engine": "claude"
  }
}
```

Los envíos internos usan `authType: internal_runtime` y omiten `authenticatedUserId`. Esta misma estructura permite agregar posteriormente `agent_runtime_token` sin cambiar el documento de mensaje.

## Configuración del perfil

El esquema de `AgenticProfile` contiene:

```json
{
  "delegation": {
    "pat": {
      "enabled": false,
      "allowedUserIds": []
    }
  }
}
```

El valor por defecto es cerrado. Habilitar la delegación es una operación administrativa deliberada y siempre debe filtrar por `orgId` y por el ID exacto del perfil.

La relación Profile -> Card se protege con un índice único parcial:

```javascript
{ orgId: 1, "agentCard.id": 1 }
```

El índice sólo participa cuando ambos campos son strings. Antes de crearlo deben buscarse duplicados; nunca se deben eliminar perfiles automáticamente para que el índice pueda entrar.

## Automatización de tareas de Zazu

`InboxTaskAutomationService` resuelve a Zazu mediante `InboxAgentIdentityService.resolveInternal()` y publica usando `InboxAgentMessageService.sendInternalToConversation()`. Ya no crea mensajes nuevos firmados como `system:zazu`.

El perfil se selecciona con `INBOX_TASK_AGENTIC_PROFILE_ID`; si no está definido, la primera versión usa el perfil de Zazu `6a6e5c9a6bf9cbb98d96cda9`. Las conversaciones históricas pueden conservar el participante legacy, pero los mensajes nuevos llevan la Agent Card y procedencia reales.

## Variables de entorno

```dotenv
INBOX_AGENT_PAT_RATE_LIMIT_PER_MINUTE=30
INBOX_TASK_AGENTIC_PROFILE_ID=6a6e5c9a6bf9cbb98d96cda9
```

El rate limit se limita internamente al rango 1–300 y se aplica en memoria por proceso, por minuto y por combinación `usuario + perfil + destinatario`. En despliegues con múltiples réplicas debe migrarse a Redis u otro contador compartido.

## Códigos de error relevantes

| Código | Causa típica |
|---|---|
| `400` | DTO inválido, source interno usado con PAT o límites excedidos. |
| `401` | Falta credencial, PAT inválido o se intentó usar Firebase en la ruta PAT-only. |
| `403` | El humano no pertenece a la organización o no está autorizado para delegar ese perfil. |
| `404` | Perfil, Agent Card o destinatario no existe en la organización. |
| `429` | Se excedió el límite por minuto. |

## Riesgos conocidos de v1

- El PAT humano sigue siendo amplio y permite otros endpoints protegidos por `ProjectAuthGuard`.
- Existe un solo PAT por usuario; rotarlo afecta a todos sus clientes.
- El rate limit no es distribuido.
- La ruta MCP todavía no propaga identidad PAT por herramienta; no debe exponerse con la clave global compartida.
- No existe aún panel de auditoría o revocación por dispositivo.

Las mejoras previstas son PATs con scope `inbox:agent:send`, allowlist de perfiles por token, expiración/rotación por dispositivo, Agent Runtime Tokens temporales, rate limit distribuido y OAuth para MCP.

## Archivos de implementación

- `src/inbox/controllers/inbox-agent.controller.ts`
- `src/inbox/guards/inbox-pat-delegation.guard.ts`
- `src/inbox/services/inbox-agent-identity.service.ts`
- `src/inbox/services/inbox-agent-message.service.ts`
- `src/inbox/services/inbox-conversation.service.ts`
- `src/inbox/services/inbox-message.service.ts`
- `src/inbox/services/inbox-task-automation.service.ts`
- `src/inbox/schemas/inbox-message.schema.ts`
- `src/agentic-profile/schemas/agentic-profile.schema.ts`

## Verificación automatizada

La suite enfocada cubre identidad derivada, allowlist PAT, fuente permitida, rate limit, conversación `agent`, firma de Agent Card, procedencia, schema defaults e idempotencia del servicio de mensajes. Además deben pasar `pnpm exec tsc --noEmit` y `pnpm build`.

Una prueba E2E real debe ejecutarse con un PAT proporcionado explícitamente por el operador; las pruebas y scripts no deben extraer ni imprimir credenciales persistidas.
