# MCP Server Integration Plan

**Goal:** Expose Control Markets as an MCP (Model Context Protocol) server so AI agents (Claude Code, Claude Desktop, any MCP client) can control the platform via natural language from the terminal — e.g., *"Move all nodes in flow 12345 to position 0,0"*.

---

## Chosen Strategy: `@rekog/mcp-nest` inside NestJS

### Why this package
- **Native NestJS integration** — uses `@Injectable()`, `@Tool()` decorators and full DI
- **Explicit Fastify support** — your current HTTP adapter is supported out of the box
- **Zero duplication** — injects your existing services directly (no HTTP layer in between)
- **Transports:** HTTP+SSE and Streamable HTTP (both work for Claude Code and Claude Desktop)

### Alternatives considered and rejected

| Option | Reason rejected |
|--------|-----------------|
| Standalone MCP Node.js process that calls REST | Extra process, extra auth hop, drift risk |
| `@modelcontextprotocol/sdk` + fastify-mcp plugin | More boilerplate, no NestJS DI |
| Claude Code Skills (`.claude/skills/`) | Brittle curl calls, no schema, unreliable |

---

## Architecture

```
Claude Code / Claude Desktop
  │  MCP protocol (HTTP+SSE or Streamable HTTP)
  ▼
NestJS McpModule  (POST /mcp)
  │  @Tool() decorated methods
  ▼
McpToolsService
  │  DI injection
  ├─ CreativeFlowboardService   → moveNodes, runFlow, getFlow, addNodes
  ├─ AgentTasksService          → getTasks, runTask
  ├─ SocialMediaTrackerService  → getPosts, schedulePost
  └─ AppUserService             → getUserProfile, getUserStats
```

---

## Phase 1 — Foundation (MVP)

### Step 1: Install package

```bash
npm install @rekog/mcp-nest zod
```

### Step 2: Register McpModule in AppModule

```typescript
// src/app.module.ts
import { McpModule } from '@rekog/mcp-nest';

@Module({
  imports: [
    // ...existing imports...
    McpModule.forRoot({
      name: 'control-markets',
      version: '1.0.0',
    }),
  ],
})
export class AppModule {}
```

For Fastify, also register the plugin in `main.ts`:

```typescript
// src/main.ts  (after app creation)
import { McpPlugin } from '@rekog/mcp-nest';
await app.register(McpPlugin);
```

### Step 3: Create `McpToolsModule`

New module at `src/mcp/`:

```
src/mcp/
├── mcp.module.ts
├── mcp-flowboard.tools.ts   ← flowboard tools
└── index.md                 ← module docs
```

**`mcp.module.ts`:**
```typescript
@Module({
  imports: [CreativeFlowboardModule],
  providers: [McpFlowboardTools],
})
export class McpModule {}
```

**`mcp-flowboard.tools.ts`:**
```typescript
import { Injectable } from '@nestjs/common';
import { Tool, Context } from '@rekog/mcp-nest';
import { z } from 'zod';
import { CreativeFlowboardService } from '../creative-flowboard/services/creative-flowboard.service';

@Injectable()
export class McpFlowboardTools {
  constructor(private flowboardService: CreativeFlowboardService) {}

  @Tool({
    name: 'moveNodes',
    description: 'Move one or more nodes on a flowboard canvas to new (x, y) positions.',
    parameters: z.object({
      flowId: z.string().describe('The ID of the flowboard.'),
      positions: z.array(
        z.object({
          nodeId: z.string(),
          x: z.number(),
          y: z.number(),
        })
      ),
    }),
  })
  async moveNodes({ flowId, positions }) {
    const result = await this.flowboardService.moveNodes(flowId, positions);
    return { success: true, flowId, updatedCount: positions.length };
  }

  @Tool({
    name: 'runFlow',
    description: 'Execute a full flowboard — runs all agent nodes in sequence.',
    parameters: z.object({
      flowId: z.string().describe('The ID of the flowboard to run.'),
    }),
  })
  async runFlow({ flowId }) {
    return await this.flowboardService.runFlow(flowId);
  }

  @Tool({
    name: 'getFlow',
    description: 'Get the full definition of a flowboard including all nodes and edges.',
    parameters: z.object({
      flowId: z.string().describe('The ID of the flowboard.'),
    }),
  })
  async getFlow({ flowId }) {
    return await this.flowboardService.findOne(flowId);
  }

  @Tool({
    name: 'addNodes',
    description: 'Add nodes and edges to an existing flowboard.',
    parameters: z.object({
      flowId: z.string().describe('The target flowboard ID.'),
      nodes: z.array(z.any()).describe('Array of node objects to add.'),
      edges: z.array(z.any()).optional().describe('Array of edge objects to add.'),
    }),
  })
  async addNodes({ flowId, nodes, edges }) {
    return await this.flowboardService.addNodes({ flowId, nodes, edges: edges ?? [] });
  }
}
```

### Step 4: Import McpModule into AppModule

```typescript
import { McpModule } from './mcp/mcp.module';

// add to imports array:
McpModule,
```

---

## Phase 2 — Authentication

The MCP endpoint needs protection. Two options:

### Option A: API Key Guard (Recommended for dev/CLI use)

Add a guard that checks `Authorization: Bearer <INTERNAL_API_KEY>` or `X-API-Key` header.

```typescript
// src/mcp/mcp-auth.guard.ts
@Injectable()
export class McpApiKeyGuard implements CanActivate {
  canActivate(ctx: ExecutionContext): boolean {
    const req = ctx.switchToHttp().getRequest();
    const key = req.headers['x-api-key'] ?? req.headers.authorization?.replace('Bearer ', '');
    return key === process.env.MCP_API_KEY;
  }
}
```

Apply it to the MCP endpoint via `@rekog/mcp-nest` guard config.

Add to `.env`:
```
MCP_API_KEY=your-secret-key-here
```

### Option B: Reuse Firebase Auth Guard

Pass a valid Firebase ID token as Bearer — same as the Angular frontend. Useful if users authenticate Claude Code with their own account.

---

## Phase 3 — Expand Tools

Once Phase 1 is working, add more tool files:

| File | Tools | Services needed |
|------|-------|-----------------|
| `mcp-flowboard.tools.ts` | moveNodes, runFlow, getFlow, addNodes | CreativeFlowboardService |
| `mcp-agents.tools.ts` | listAgentCards, getAgentCard, runAgentTask | AgentCardService, AgentTasksService |
| `mcp-social.tools.ts` | listScheduledPosts, createPost, updatePost | SocialMediaTrackerService |
| `mcp-user.tools.ts` | getUserProfile, getUserStats | AppUserService |
| `mcp-assets.tools.ts` | listAssets, getAsset | StorageAssetModule |

---

## Phase 4 — Claude Code Registration

Once the server is running, users (and you) register it in Claude Code:

```bash
# Streamable HTTP transport (recommended)
claude mcp add control-markets \
  --transport http \
  --url http://localhost:3000/mcp \
  --header "x-api-key: your-secret-key-here"
```

Or via `~/.claude/settings.json`:
```json
{
  "mcpServers": {
    "control-markets": {
      "type": "http",
      "url": "http://localhost:3000/mcp",
      "headers": {
        "x-api-key": "your-secret-key-here"
      }
    }
  }
}
```

Then from any Claude Code session:
```
> "List all nodes in flow abc123"
> "Move the agent node to position 100, 200 in flow abc123"
> "Run the full flow abc123"
> "Add a new AgentNodeComponent to flow abc123"
```

---

## Phase 5 — Production Deployment

For production (hosted server), use:
- `MCP_API_KEY` stored in secrets manager (not `.env`)
- HTTPS endpoint: `https://api.control-markets.com/mcp`
- Consider per-user scoping by passing user context via headers

---

## Implementation Order

```
[ ] Phase 1: npm install + McpModule.forRoot() + McpFlowboardTools (moveNodes, runFlow, getFlow)
[ ] Phase 2: McpApiKeyGuard + MCP_API_KEY env var
[ ] Phase 3: Test with `claude mcp add` locally
[ ] Phase 4: Add remaining tool files (agents, social, user)
[ ] Phase 5: Document user-facing setup in project README
```

---

## Key Files to Create/Modify

| Action | File |
|--------|------|
| MODIFY | `src/app.module.ts` — add McpModule import |
| MODIFY | `src/main.ts` — register McpPlugin for Fastify |
| CREATE | `src/mcp/mcp.module.ts` |
| CREATE | `src/mcp/mcp-flowboard.tools.ts` |
| CREATE | `src/mcp/mcp-auth.guard.ts` |
| CREATE | `src/mcp/index.md` |
| MODIFY | `.env` — add MCP_API_KEY |

---

## MCP Endpoint

Once deployed, the MCP server will be available at:
```
POST /mcp          ← Streamable HTTP (recommended)
GET  /mcp/sse      ← SSE transport fallback
```
