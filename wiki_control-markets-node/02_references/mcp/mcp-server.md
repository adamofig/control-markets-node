# MCP Server

Control Markets exposes itself as an **MCP (Model Context Protocol) server** so AI agents — Claude Code, Claude Desktop, or any MCP client — can control the platform via natural language from the terminal.

---

## How it works

The integration uses [`@rekog/mcp-nest`](https://github.com/rekog-labs/mcp-nest), which plugs directly into NestJS with `@Injectable()` and `@Tool()` decorators. No extra process is needed — the MCP server runs inside the same NestJS/Fastify instance on port `8121`.

```
Claude Code / Claude Desktop
  │  MCP protocol (Streamable HTTP, stateful)
  ▼
POST /mcp   ←  NestJS McpModule (McpModule.forRoot)
  │
AppMcpModule.forFeature  →  McpFlowboardTools
  │
CreativeFlowboardService
```

---

## Endpoints

| Method | Path | Description |
| :----- | :--- | :---------- |
| `POST` | `/mcp` | All MCP operations (initialize, tools/list, tools/call) |
| `GET` | `/mcp` | SSE stream for server-sent push events |
| `DELETE` | `/mcp` | Terminate a session |

### Required request headers

```
Content-Type: application/json
Accept: application/json, text/event-stream
```

After initialization, all requests must also include:

```
mcp-session-id: <value from initialize response header>
```

### Session handshake (required)

The MCP Streamable HTTP protocol requires a two-step handshake before any tool can be called:

1. `POST /mcp` → `method: "initialize"` — server returns `mcp-session-id` in the **response header**
2. `POST /mcp` → `method: "notifications/initialized"` + `mcp-session-id` header
3. All subsequent calls (`tools/list`, `tools/call`, etc.) send the same `mcp-session-id` header

---

## Available tools

### `listFlows`
List all available flowboards with their IDs, names, and node count.

*No parameters required.*

### `getFlow`
Get the full definition of a flowboard including all nodes and edges.

| Parameter | Type | Description |
| :-------- | :--- | :---------- |
| `flowId` | `string` | The ID of the flowboard |

### `runNode`
Execute a single node within a flowboard (async — node runs in background). Returns the initial `IFlowExecutionState`.

| Parameter | Type | Description |
| :-------- | :--- | :---------- |
| `flowId` | `string` | The ID of the flowboard |
| `nodeId` | `string` | The ID of the node to execute |

### `runAndWait`
Execute a single node and block until the result is ready. Returns the completed `AgentOutcomeJob` with the AI-generated content.

| Parameter | Type | Description |
| :-------- | :--- | :---------- |
| `flowId` | `string` | The ID of the flowboard |
| `nodeId` | `string` | The ID of the node to execute |

### `runFlow`
Execute a full flowboard — runs all agent nodes in sequence. Returns the initial `IFlowExecutionState`.

| Parameter | Type | Description |
| :-------- | :--- | :---------- |
| `flowId` | `string` | The ID of the flowboard to run |

### `moveNodes`
Move one or more nodes to new (x, y) positions on the canvas.

| Parameter | Type | Description |
| :-------- | :--- | :---------- |
| `flowId` | `string` | The ID of the flowboard |
| `positions` | `{ nodeId, x, y }[]` | Array of node positions to update |

### `addNodes`
Add nodes and edges to an existing flowboard.

| Parameter | Type | Description |
| :-------- | :--- | :---------- |
| `flowId` | `string` | The target flowboard ID |
| `nodes` | `any[]` | Array of node objects to add |
| `edges` | `any[]` (optional) | Array of edge objects to add |

---

## Key source files

| File | Purpose |
| :--- | :------- |
| `src/mcp/mcp.module.ts` | `AppMcpModule` — registers tools via `McpModule.forFeature` |
| `src/mcp/mcp-flowboard.tools.ts` | `@Tool()` implementations for flowboard operations |
| `src/mcp/mcp-auth.guard.ts` | API key guard (not yet applied — endpoint is open) |
| `src/app.module.ts` | `McpModule.forRoot()` + `AppMcpModule` registered here |
| `docs/bruno-docs/mcp_test.http` | REST Client requests for local testing |

---

## How tool registration works

`@rekog/mcp-nest` discovers tools by scanning only the module that directly imports `McpModule.forRoot`. Tools defined in child modules are **not** auto-discovered.

To register tools from a child module (`AppMcpModule`), use `McpModule.forFeature()`:

```typescript
// src/mcp/mcp.module.ts
@Module({
  imports: [
    CreativeFlowboardModule,
    McpModule.forFeature([McpFlowboardTools], 'control-markets'), // <-- required
  ],
  providers: [McpFlowboardTools],
})
export class AppMcpModule {}
```

The second argument `'control-markets'` must match the `name` in `McpModule.forRoot({ name: 'control-markets', ... })`.

Without `forFeature`, `tools/list` returns an empty array and `capabilities: {}` in the initialize response.

---

## Register in Claude Code (local)

### Prerequisites
- The Control Markets server must be running locally (`npm run start:dev`)
- Claude Code CLI must be installed

### Step 1 — Start the server

```bash
npm run start:dev
# Server starts on http://localhost:8121
# MCP endpoint: http://localhost:8121/mcp
```

### Step 2 — Register the MCP server in Claude Code

The URL is a **positional argument**, not a flag:

```bash
claude mcp add --transport http control-markets http://localhost:8121/mcp
```

> Note: `--url` is not a valid flag — the URL must come after the server name.

### Step 3 — Verify registration

```bash
claude mcp list
```

You should see `control-markets` listed with its HTTP transport and endpoint.

### Step 4 — Use it

Start a Claude Code session and talk to it naturally:

```
> "Get flow abc123"
> "Run the full flow abc123"
> "Move the agent node to position 100, 200 in flow abc123"
> "Add a new AgentNodeComponent to flow abc123"
```

Claude will automatically discover and call the available tools.

---

## Testing with curl

A ready-made HTTP request file is at `docs/bruno-docs/mcp_test.http` (requires VS Code REST Client extension). To test manually with curl:

```bash
# 1. Initialize — capture session ID from response header
SESSION_ID=$(curl -s -D - -X POST http://localhost:8121/mcp \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -d '{"jsonrpc":"2.0","method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"test","version":"1.0"}},"id":1}' \
  | grep -i "mcp-session-id" | awk '{print $2}' | tr -d '\r')

# 2. Send initialized notification
curl -s -X POST http://localhost:8121/mcp \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -H "mcp-session-id: $SESSION_ID" \
  -d '{"jsonrpc":"2.0","method":"notifications/initialized","params":{}}'

# 3. List tools
curl -s -X POST http://localhost:8121/mcp \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -H "mcp-session-id: $SESSION_ID" \
  -d '{"jsonrpc":"2.0","method":"tools/list","params":{},"id":2}'
```

---

## Troubleshooting

| Error | Cause | Fix |
| :---- | :---- | :-- |
| `Method not allowed in stateless mode` | `statelessMode: true` rejects the MCP initialize handshake | Set `statelessMode: false` and `sessionIdGenerator: () => randomUUID()` in `McpModule.forRoot()` — already configured |
| `tools/list` returns empty array | Tools in child modules are not auto-discovered | Use `McpModule.forFeature([YourTool], 'server-name')` in the child module |
| `capabilities: {}` in initialize response | Same root cause as empty tools/list | Same fix — `forFeature` is required |
| `Not Acceptable: Client must accept both...` | Missing `Accept` header | Add `Accept: application/json, text/event-stream` to every request |
| `Cannot find module '@nestjs/jwt'` | `@rekog/mcp-nest` eagerly loads its authz module | Run `npm install @nestjs/jwt @nestjs/passport passport --legacy-peer-deps` |
| `unknown option '--url'` | URL is positional in Claude Code CLI, not a flag | Use `claude mcp add --transport http <name> <url>` |

---

## Authentication (Phase 2 — not yet enabled)

`src/mcp/mcp-auth.guard.ts` contains a ready-to-use `McpApiKeyGuard` that reads the `MCP_API_KEY` environment variable. To enable it, apply the guard to the MCP module and add `MCP_API_KEY=your-secret` to `.env`.

---

## Adding more tools

To expose more services, create a new tools file in `src/mcp/`, add it to `AppMcpModule`, and register it with `forFeature`:

```typescript
// src/mcp/mcp.module.ts
McpModule.forFeature([McpFlowboardTools, McpAgentsTools, McpSocialTools], 'control-markets'),
```

| Suggested file | Services | Example tools |
| :------------- | :------- | :------------ |
| `mcp-agents.tools.ts` | `AgentCardService`, `AgentTasksService` | `listAgentCards`, `runAgentTask` |
| `mcp-social.tools.ts` | `SocialMediaTrackerService` | `listScheduledPosts`, `createPost` |
| `mcp-user.tools.ts` | `AppUserService` | `getUserProfile` |
| `mcp-assets.tools.ts` | `StorageAssetModule` | `listAssets`, `getAsset` |
