# MCP Tools Expansion Plan

> **Objetivo**: Exponer todos los recursos relevantes de Control Markets como herramientas MCP para que Claude Code y otros agentes IA puedan controlar la plataforma completa desde la terminal.
>
> **Estado actual**: 4 herramientas activas en `mcp-flowboard.tools.ts` — `getFlow`, `runFlow`, `moveNodes`, `addNodes`.

---

## Resumen de herramientas propuestas

| Archivo a crear | Servicio(s) | Herramientas | Prioridad |
| :-------------- | :---------- | :----------- | :-------- |
| `mcp-flowboard.tools.ts` *(extender)* | `CreativeFlowboardService` | +`listFlows`, `runNode`, `runAndWait` | **Alta** |
| `mcp-agent-tasks.tools.ts` | `AgentTasksService`, `AgentJobService` | `listAgentTasks`, `getAgentTask`, `executeAgentTask`, `listAgentJobs`, `getJobsByTask` | **Alta** |
| `mcp-sources.tools.ts` | `AgentSourcesService`, `InspirationSourceService` | `listSources`, `getSource`, `listInspirationSources` | **Alta** |
| `mcp-social.tools.ts` | `SocialMediaTrackerService` | `listScheduledPosts`, `getSocialPost`, `createSocialPost`, `updateSocialPost` | **Media** |
| `mcp-video.tools.ts` | `VideoProjectGeneratorService` | `listVideoProjects`, `addSourceToVideoProject`, `addAgentCardToVideoProject` | **Media** |
| `mcp-recent.tools.ts` | `RecentResourcesService` | `getRecentResources` | **Baja** |
| `mcp-user.tools.ts` | `UserService` | `getUserProfile` | **Baja** |

---

## 1. Extender `mcp-flowboard.tools.ts` — Prioridad Alta

Estos métodos ya existen en `CreativeFlowboardService` y sólo necesitan exponerse.

### `listFlows`
Listar todos los flowboards disponibles.

```typescript
@Tool({ name: 'listFlows', description: 'List all available flowboards.' })
async listFlows() { ... }
// Servicio: flowboardService.findAll()
```

### `runNode`
Ejecutar un nodo específico dentro de un flowboard.

| Parámetro | Tipo | Descripción |
| :-------- | :--- | :---------- |
| `flowId` | `string` | ID del flowboard |
| `nodeId` | `string` | ID del nodo a ejecutar |

```typescript
// Servicio: flowboardService.runNodev2(flowId, nodeId)
```

### `runAndWait`
Ejecutar un nodo y esperar el resultado completo del job (bloqueante).

| Parámetro | Tipo | Descripción |
| :-------- | :--- | :---------- |
| `flowId` | `string` | ID del flowboard |
| `nodeId` | `string` | ID del nodo |

```typescript
// Servicio: flowboardService.runAndWait(flowId, nodeId)
// Retorna el resultado del AgentOutcomeJob directamente
```

---

## 2. `mcp-agent-tasks.tools.ts` — Prioridad Alta

Expone el motor central de ejecución de tareas de agentes. Permite al agente IA inspeccionar, crear y ejecutar tareas.

**Módulo fuente**: `src/agent-tasks/`
**Servicios**: `AgentTasksService`, `AgentJobService`

### `listAgentTasks`
Listar todas las tareas de agentes disponibles.

```typescript
// Servicio: agentTasksService.findAll()
```

### `getAgentTask`

| Parámetro | Tipo | Descripción |
| :-------- | :--- | :---------- |
| `taskId` | `string` | ID de la tarea |

```typescript
// Servicio: agentTasksService.findOne(taskId)
```

### `executeAgentTask`
Ejecutar una tarea de agente por ID. Dispara la lógica LLM completa.

| Parámetro | Tipo | Descripción |
| :-------- | :--- | :---------- |
| `taskId` | `string` | ID de la tarea a ejecutar |

```typescript
// Servicio: agentTasksService.execute(taskId)
```

### `listAgentJobs`
Listar los jobs de ejecución (historial de resultados).

```typescript
// Servicio: agentJobService.findAll()
```

### `getJobsByTask`
Obtener todos los jobs de ejecución de una tarea específica.

| Parámetro | Tipo | Descripción |
| :-------- | :--- | :---------- |
| `taskId` | `string` | ID de la tarea |

```typescript
// Servicio: agentJobService.findByTaskId(taskId)
```

### `getJobsByStatus`
Filtrar jobs por estado (`pending`, `running`, `done`, `error`).

| Parámetro | Tipo | Descripción |
| :-------- | :--- | :---------- |
| `status` | `string` | Estado a filtrar |

```typescript
// Servicio: agentJobService.findByStatus(status)
```

---

## 3. `mcp-sources.tools.ts` — Prioridad Alta

Expone las fuentes de conocimiento (URLs, docs, YouTube) que alimentan a los agentes. Permite al agente IA descubrir qué información está disponible.

**Módulo fuente**: `src/agent-tasks/services/agent-sources.service.ts`, `src/inspiration-source/`

### `listAgentSources`
Listar todas las fuentes de conocimiento (`agent_sources`).

```typescript
// Servicio: agentSourcesService.findAll()
```

### `getAgentSource`

| Parámetro | Tipo | Descripción |
| :-------- | :--- | :---------- |
| `sourceId` | `string` | ID de la fuente |

```typescript
// Servicio: agentSourcesService.findOne(sourceId)
```

### `listInspirationSources`
Listar las fuentes de inspiración del módulo dedicado.

```typescript
// Servicio: inspirationSourceService.findAll()
```

---

## 4. `mcp-social.tools.ts` — Prioridad Media

Expone el planificador de contenido social. El agente puede leer el calendario, crear y programar publicaciones.

**Módulo fuente**: `src/social-media-tracker/`
**Servicio**: `SocialMediaTrackerService`

### `listScheduledPosts`
Listar todas las publicaciones programadas en `social_media_tracker`.

```typescript
// Servicio: socialMediaTrackerService.findAll() / queryUsingFiltersConfig(...)
```

### `getSocialPost`

| Parámetro | Tipo | Descripción |
| :-------- | :--- | :---------- |
| `postId` | `string` | ID de la publicación |

### `createSocialPost`
Crear una nueva publicación en el tracker.

| Parámetro | Tipo | Descripción |
| :-------- | :--- | :---------- |
| `post` | `object` | Datos de la publicación (título, plataforma, fecha, contenido) |

### `updateSocialPost`

| Parámetro | Tipo | Descripción |
| :-------- | :--- | :---------- |
| `postId` | `string` | ID de la publicación |
| `updates` | `object` | Campos a actualizar |

---

## 5. `mcp-video.tools.ts` — Prioridad Media

Permite al agente gestionar proyectos de video, asociarles fuentes y agent cards.

**Módulo fuente**: `src/video-projects/`
**Servicio**: `VideoProjectGeneratorService`

### `listVideoProjects`
Listar todos los proyectos de video.

### `addSourceToVideoProject`

| Parámetro | Tipo | Descripción |
| :-------- | :--- | :---------- |
| `videoProjectId` | `string` | ID del proyecto de video |
| `sourceId` | `string` | ID de la fuente a asociar |

```typescript
// Servicio: videoProjectService.addSourceToVideoProject(videoProjectId, sourceId)
```

### `addAgentCardToVideoProject`

| Parámetro | Tipo | Descripción |
| :-------- | :--- | :---------- |
| `videoProjectId` | `string` | ID del proyecto de video |
| `agentCardId` | `string` | ID del agent card |

```typescript
// Servicio: videoProjectService.addAgentCardToVideoProject(videoProjectId, agentCardId)
```

---

## 6. `mcp-recent.tools.ts` — Prioridad Baja

Contexto de navegación del usuario. Útil para que el agente sepa qué recursos ha visitado recientemente y pueda operar sobre ellos sin que el usuario tenga que copiar IDs.

**Módulo fuente**: `src/recent-resources/`
**Servicio**: `RecentResourcesService`

### `getRecentResources`
Obtener los últimos recursos visitados por el usuario autenticado.

| Parámetro | Tipo | Descripción |
| :-------- | :--- | :---------- |
| `limit` | `number` (opcional) | Máximo de recursos a retornar (default: 5) |

```typescript
// Servicio: recentResourcesService.getRecentForUser(userId, limit)
```

> **Nota**: Esta herramienta es especialmente poderosa combinada con otras — el agente puede preguntar "trabajar con el flowboard que estaba usando" sin necesidad de ID explícito.

---

## 7. `mcp-user.tools.ts` — Prioridad Baja

Contexto del usuario autenticado. Permite que el agente personalice sus respuestas y sepa con quién está interactuando.

**Módulo fuente**: `src/user/`
**Servicio**: `UserService`

### `getUserProfile`
Obtener el perfil del usuario autenticado.

```typescript
// Servicio: userService.findOne(userId)
```

---

## Orden de implementación recomendado

```
Fase 1 — Core (habilita workflows completos)
  1. Extender mcp-flowboard.tools.ts  →  listFlows, runNode, runAndWait
  2. mcp-agent-tasks.tools.ts         →  listAgentTasks, executeAgentTask, getJobsByTask

Fase 2 — Contexto rico
  3. mcp-sources.tools.ts             →  listAgentSources, getAgentSource
  4. mcp-recent.tools.ts              →  getRecentResources  (elimina necesidad de IDs)

Fase 3 — Dominio completo
  5. mcp-social.tools.ts              →  CRUD social posts
  6. mcp-video.tools.ts               →  gestión video projects
  7. mcp-user.tools.ts                →  contexto usuario
```

---

## Registro en `AppMcpModule`

Cuando se creen los nuevos archivos, registrarlos en [src/mcp/mcp.module.ts](../../src/mcp/mcp.module.ts):

```typescript
McpModule.forFeature(
  [
    McpFlowboardTools,
    McpAgentTasksTools,    // Fase 1
    McpSourcesTools,       // Fase 2
    McpRecentTools,        // Fase 2
    McpSocialTools,        // Fase 3
    McpVideoTools,         // Fase 3
    McpUserTools,          // Fase 3
  ],
  'control-markets',
),
```

---

## Casos de uso que se habilitan

Una vez implementadas todas las fases, Claude Code podrá:

```
> "Lista mis flowboards y ejecuta el que tenga 'content' en el nombre"
> "¿Cuál fue el último recurso que abrí? Ejecútalo."
> "Ejecuta la tarea 'weekly-report' y muéstrame el resultado"
> "¿Qué posts tengo programados para esta semana?"
> "Crea un post para LinkedIn sobre el resultado del último job"
> "Añade la fuente X al video project Y"
> "¿Qué fuentes de conocimiento hay disponibles para los agentes?"
```
