# MessagingModule — Canal de Mensajería Externa (Telegram)

> Implementación inicial (2026-07-05) del canal agente → humano y humano → agente vía Telegram.
> Diseño basado en la exploración de Borges: `control-markets-wiki/12_agents/BORGES/explorations/2026-07-04-canal-mensajeria-whatsapp-telegram.md`.

## Objetivo

Que los perfiles agénticos (heartbeats, tareas, tools MCP) puedan **escribirle a usuarios/empleados** de la plataforma (recordatorios de tareas, avances, alertas) y que estos puedan **conversar de vuelta** con el bucle ReAct existente. Escalable a WhatsApp/Discord agregando adapters.

## Arquitectura (`src/messaging/`)

```
Telegram Bot API (long-polling getUpdates, sin webhook público)
        │
   TelegramAdapter  ──implements──▶  IChannelAdapter (strategy, como INodeProcessor)
        │ inbound
        ▼
ChannelGatewayService
  1. /start <token>  → completa vinculación (deep-link)
  2. sin identidad verified → descarta + aviso (opt-in obligatorio)
  3. buffer anti-fragmentos 5 s por chat (patrón Hermes)
  4. routeToAgent → ChatService.streamChat (bucle ReAct, Vercel AI SDK)
        │ outbound (respuesta troceada a 4.096 chars, fallback markdown→plain)
        ▼
MessagingOutboundService.notifyUser(userId, orgId, text, opts)
  → resuelve identidad verificada → adapter.sendText → audita en outbound_messages
```

### Archivos

| Archivo | Rol |
|---|---|
| `adapters/channel-adapter.interface.ts` | Contrato `IChannelAdapter`: `isEnabled`, `onInbound`, `sendText` |
| `adapters/telegram.adapter.ts` | Bot API oficial vía `fetch` nativo, long-polling, chunking 4096, retry sin Markdown |
| `services/channel-gateway.service.ts` | Ruteo entrante, vinculación, buffer, despacho al bucle ReAct |
| `services/messaging-outbound.service.ts` | API interna única de notificaciones + gestión de identidades |
| `messaging.controller.ts` | Endpoints REST (guard PAT/Firebase) |
| `schemas/channel-identity.schema.ts` | Colección `channel_identities` |
| `schemas/outbound-message.schema.ts` | Colección `outbound_messages` |
| `src/mcp/mcp-messaging.tools.ts` | Tool MCP `messaging_notifyUser` |

## Colecciones MongoDB

- **`channel_identities`** — `{ userId, orgId, channel, address (chatId), status: pending|verified|revoked, linkToken, agenticProfileId?, metadata }`. Scoped a org. Índices: `(channel, address)`, `linkToken` sparse, `(userId, orgId)`.
- **`outbound_messages`** — auditoría de todo saliente: `{ orgId, userId, channel, address, text, status: queued|sent|failed, source (heartbeat|task|mcp|manual|system), sourceRef, providerMessageId, error }`.

## Endpoints REST (`api/messaging`, `ProjectAuthGuard`)

| Método | Ruta | Descripción |
|---|---|---|
| POST | `/telegram/link` | Genera deep-link `t.me/<bot>?start=<token>` (token TTL 15 min) |
| GET | `/identities` | Lista canales vinculados del usuario |
| DELETE | `/identities/:id` | Desvincula |
| POST | `/notify` | `{ userId?, message, channel? }` — notificación manual/prueba |

## Flujo de vinculación (opt-in)

1. Frontend llama `POST /api/messaging/telegram/link` → recibe `linkUrl`.
2. Usuario abre el link → Telegram manda `/start <token>` al bot.
3. Gateway valida token pendiente no expirado → marca identidad `verified` con el `chatId`.
4. Desde ahí: agentes pueden notificar (`notifyUser`) y el usuario puede conversar.

## Uso interno (heartbeat, tareas, canvas)

```ts
// inyectar MessagingOutboundService (MessagingModule lo exporta)
await this.messagingOutbound.notifyUser(userId, orgId, '📋 Tarea asignada: …', {
  source: 'heartbeat',
  sourceRef: runId,
});
```

Desde agentes vía MCP: tool `messaging_notifyUser` (userId, orgId, message, channel?, sourceRef?).

## Configuración

```
TELEGRAM_BOT_TOKEN=      # de @BotFather
TELEGRAM_BOT_USERNAME=   # sin @, para los deep-links
```

Sin token, el adapter queda deshabilitado (log warn) y el resto de la app funciona normal.

## Próximas fases

1. ✅ Telegram end-to-end (esta implementación)
2. `WhatsAppCloudAdapter` (Cloud API oficial, templates utility, ventana 24 h)
3. Multi-agent routing real por identidad (`agenticProfileId` → agent card)
4. UI Angular de vinculación en perfil de usuario; audio STT/TTS
