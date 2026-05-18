# Plan: Discord como Sistema de Notificación y Comunicación del Equipo

**Estado:** En análisis  
**Última actualización:** 2026-05-17  
**Autor:** Adamo  
**Relacionado con:** [Plan gestión de colaboradores](Plan-para%20genestion-de-empleados.md)

---

## 1. Por qué Discord (y no Telegram)

El plan anterior recomendó Telegram como canal principal. Discord es una alternativa válida cuando el equipo **ya usa Discord** o cuando la comunicación entre colaboradores es tan importante como las notificaciones del sistema. La diferencia clave:

| Criterio | Telegram | Discord |
|---|---|---|
| Notificaciones bot → persona | ✅ Excelente | ✅ Excelente |
| Comunicación entre colaboradores | ❌ Requiere grupo adicional | ✅ Nativo (canales, hilos) |
| Estructura de servidor/canales | ❌ No tiene | ✅ Canales por proyecto/rol |
| Slash commands | Básico | ✅ Rico (modals, selects, buttons) |
| Costo | Gratis | Gratis (Nitro opcional) |
| Penetración general | Alta | Alta en equipos tech/creativos |

**Conclusión:** Si el equipo son 5 colaboradores que necesitan comunicarse entre sí además de recibir tareas, Discord es la mejor opción porque provee **notificaciones + espacio de trabajo** en un solo lugar.

---

## 2. Arquitectura del servidor Discord

### Estructura de canales recomendada para 5 colaboradores

```
📁 CONTROL MARKETS — [Nombre de tu org]
│
├── 📢 anuncios          (solo el bot puede escribir — noticias del sistema)
├── 💬 general           (comunicación libre del equipo)
│
├── 📁 TAREAS
│   ├── 📋 mis-tareas    (cada quien ve las suyas — bot las posta aquí con menciones)
│   ├── 🔔 pendientes    (tareas sin confirmar — bot las lista diario)
│   └── ✅ completadas   (registro de lo que se terminó)
│
├── 📁 PROYECTOS         (un canal por proyecto/cliente si lo necesitan)
│   └── #proyecto-x
│
└── 📁 BOT
    ├── 🤖 comandos      (canal donde los colaboradores interactúan con el bot)
    └── 📊 reportes      (el bot posta el daily digest del admin aquí)
```

### Roles en el servidor Discord

| Rol Discord | Quién lo tiene | Permisos |
|---|---|---|
| `@Admin` | Tú (dueño de la org) | Todo |
| `@Colaborador` | Los 5 miembros | Leer canales, escribir en `general` y `comandos` |
| `@Bot` | El bot de Control Markets | Escribir en todos, mencionar usuarios |

---

## 3. Cómo el bot conecta con la plataforma

### Flujo de vinculación (onboarding del colaborador)

```
1. Admin abre perfil del colaborador en Control Markets
2. El sistema genera un código único de vinculación: CM-LINK-<token>
3. Admin comparte el código con el colaborador (mensaje directo, email, etc.)
4. Colaborador va al canal #comandos en Discord y escribe:
       /vincular CM-LINK-<token>
5. El bot registra su Discord userId en HumanResource.contactChannels.discord
6. Bot responde: "✅ Cuenta vinculada. Recibirás tus tareas aquí."
```

### Flujo de notificación de tarea asignada

```
1. Admin asigna tarea en Control Markets
2. NestJS emite evento: task.assigned
3. NotificationService busca HumanResource → obtiene discordUserId
4. Bot envía DM al colaborador con un embed:

   ┌─────────────────────────────────────┐
   │ 📋 Nueva tarea asignada             │
   │ Nombre: Editar video TikTok #23     │
   │ Prioridad: 🔴 Urgente               │
   │ Vence: Hoy 18:00                    │
   │                                     │
   │ [✅ Confirmar]  [💬 Comentar]       │
   └─────────────────────────────────────┘

5. También posta en #mis-tareas con mención @colaborador
6. Si confirma → task.status = in_progress, bot edita el mensaje
7. Si comenta → bot abre un hilo privado para la conversación
8. NotificationService guarda registro en notification_logs
```

---

## 4. Cambios al modelo de datos

### 4.1 Extender `IHumanResource`

Agregar `discord` dentro de `contactChannels` (en paralelo con `telegram` del plan anterior):

```typescript
interface IHumanResource {
  // ... campos existentes ...

  contactChannels?: {
    telegram?: { chatId: string; username?: string; isActive: boolean; linkedAt: Date };
    discord?: {
      userId: string;        // Discord user snowflake ID (ej: "123456789012345678")
      username: string;      // user#discriminator o username nuevo (ej: "adamo")
      isActive: boolean;
      linkedAt: Date;
      guildId: string;       // ID del servidor donde se vinculó
    };
    whatsapp?: { phone: string; isActive: boolean };
  };

  notificationPreferences?: {
    channels: ('telegram' | 'discord' | 'email' | 'push')[];
    quietHours?: { from: string; to: string; timezone: string };
    frequency?: 'immediate' | 'daily_digest' | 'weekly';
  };
}
```

### 4.2 Extender `ITask` (igual que en el plan de Telegram)

```typescript
interface ITask {
  // ... campos existentes ...
  dueDate?: Date;
  priority?: 'low' | 'medium' | 'high' | 'urgent';
  reminderConfig?: { enabled: boolean; intervals: number[] }; // horas antes: [24, 4, 1]
}
```

### 4.3 Nueva colección: `notification_logs`

```typescript
interface INotification {
  _id?: string;
  orgId: string;
  recipientId: string;
  userId: string;
  channel: 'telegram' | 'discord' | 'email' | 'push' | 'whatsapp';
  type: 'task_assigned' | 'task_reminder' | 'task_overdue' | 'task_feedback' | 'general';
  referenceId: string;
  referenceType: 'task' | 'flow' | 'job';
  message: string;
  status: 'pending' | 'sent' | 'delivered' | 'failed' | 'read';
  sentAt?: Date;
  readAt?: Date;
  externalId?: string;    // Discord message ID (para editar/borrar el mensaje)
  errorMessage?: string;
  createdAt: Date;
}
```

---

## 5. Arquitectura NestJS

### Librería recomendada: `necord`

`necord` es un wrapper NestJS sobre `discord.js` con decoradores al estilo NestJS. Es la versión Discord de `nestjs-telegraf`.

```bash
npm install necord discord.js
```

### Módulos a crear

```
control-markets-node/
│
├── DiscordModule (nuevo)
│   ├── DiscordBotService          ← envía mensajes, embeds, DMs
│   ├── DiscordCommandsController  ← slash commands (/vincular, /mis-tareas, /estado)
│   ├── DiscordInteractionHandler  ← botones y selects (Confirmar, Comentar)
│   └── DiscordLinkService         ← genera tokens de vinculación y los persiste
│
├── NotificationModule (nuevo — compartido con Telegram)
│   ├── NotificationService        ← decide canal según HR.notificationPreferences
│   ├── NotificationScheduler      ← cron: recordatorios, tareas vencidas, daily digest
│   └── notification_logs schema
│
└── HumanResourcesModule (existente — extender schema)
    └── contactChannels.discord + notificationPreferences
```

### Slash commands del bot

| Comando | Quién lo usa | Qué hace |
|---|---|---|
| `/vincular <token>` | Colaborador | Vincula su Discord con su perfil en la plataforma |
| `/mis-tareas` | Colaborador | Lista sus tareas pendientes y en progreso |
| `/completar <id>` | Colaborador | Marca tarea como done desde Discord |
| `/estado <id>` | Colaborador | Reporta un comentario/bloqueo en una tarea |
| `/equipo` | Admin | Muestra estado del equipo (quién tiene qué pendiente) |

---

## 6. Comunicación entre colaboradores

Discord resuelve esto nativamente con la estructura de canales:

| Necesidad | Solución Discord |
|---|---|
| Hablar en general | Canal `#general` |
| Discutir una tarea específica | Hilo en el mensaje de la tarea en `#mis-tareas` |
| Preguntarle algo al admin | Mención `@Admin` en `#general` o DM directo |
| Coordinarse en un proyecto | Canal dedicado `#proyecto-x` |
| Ver quién tiene qué | Comando `/equipo` o canal `#pendientes` (actualizado por el bot) |

El bot abre hilos automáticamente cuando un colaborador presiona "💬 Comentar" en una notificación de tarea, centralizando la conversación junto al contexto de la tarea.

---

## 7. Decisiones

| Decisión | Elegido | Razón |
|---|---|---|
| Canal principal | **Discord** | Notificaciones + comunicación de equipo en un lugar |
| Librería NestJS | **`necord` + `discord.js`** | Decoradores nativos NestJS, activamente mantenida |
| Tipo de mensajes | **Embeds + botones** | Más ricos que texto plano, acciones inline |
| Onboarding | **Slash command `/vincular`** | Sin intervención del admin después del primer token |
| DMs vs canal | **DMs para tareas individuales + canal para equipo** | Privacidad + visibilidad según contexto |
| Recordatorios | **Cron interno** (`@nestjs/schedule`) | Nativo en NestJS |
| Dónde vive la lógica | **Interno (NestJS)** | Datos seguros, un solo sistema |

---

## 8. Plan de implementación

### Fase 1 — Fundación (MVP)
- [ ] Crear servidor Discord de la org y configurar canales/roles
- [ ] Registrar bot Discord en Discord Developer Portal
- [ ] Instalar `necord` y crear `DiscordModule` básico
- [ ] Implementar `/vincular <token>` y flujo de deep-link (token → Discord userId → HR)
- [ ] Notificación por DM al asignar tarea (`task_assigned`) con embed básico
- [ ] Guardar registro en `notification_logs`

### Fase 2 — Interacción
- [ ] Botones inline: Confirmar, Comentar (actualiza `task.status` desde Discord)
- [ ] Comando `/mis-tareas` — lista personal
- [ ] Abrir hilo automático cuando el colaborador comenta
- [ ] Cron de recordatorios (`task_reminder`) 24h y 1h antes del vencimiento
- [ ] Alerta de tarea vencida (`task_overdue`) en DM + canal `#pendientes`

### Fase 3 — Visibilidad del admin
- [ ] Comando `/equipo` — estado del equipo en tiempo real
- [ ] Daily digest en canal `#reportes` (resumen de tareas del día)
- [ ] Dashboard en Angular sincronizado con estado de notificaciones Discord
- [ ] Notificación al admin cuando un colaborador reporta bloqueo

---

## 9. Referencias técnicas

- **Librería principal:** `necord` — [https://necord.org](https://necord.org)
- **discord.js:** [https://discord.js.org](https://discord.js.org)
- **Discord Developer Portal:** [https://discord.com/developers/applications](https://discord.com/developers/applications)
- **Discord Slash Commands docs:** [https://discord.com/developers/docs/interactions/application-commands](https://discord.com/developers/docs/interactions/application-commands)
- **Discord Embeds:** [https://discord.com/developers/docs/resources/message#embed-object](https://discord.com/developers/docs/resources/message#embed-object)
- **Scheduler NestJS:** `@nestjs/schedule` con `@Cron(CronExpression.EVERY_HOUR)`
- **Entity scaffold:** usar skill `/entity-scaffold` para crear `NotificationModule`
