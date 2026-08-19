import { Injectable } from '@nestjs/common';
import { tool } from 'ai';
import { z } from 'zod';
import { CmResourceResolver } from './cm-resource.resolver';
import { CmResourceContext } from './cm-resource.models';
import { buildCmUri } from './cm-uri.util';

/**
 * The Vercel-harness door.
 *
 * Three tools come out of here, and the split matters:
 *
 * - **`cmRead`** is the verb. One description to maintain instead of five.
 * - **`getSkill` and `getProfileSource`** stay registered and delegate. They are NOT removed: the
 *   synced profiles in Mongo name them in their indexes, and live conversations have them in their
 *   history. A tool that vanishes mid-conversation turns into a hallucinated call. They are marked
 *   deprecated in their own descriptions so the model migrates on its own.
 *
 * Registering `cmRead` has a second effect that is easy to miss: `LocalAgentChatService`
 * derives its `AgenticRuntimeProfile` from the real keys of this object, and
 * `ContextAccessRenderer` switches to `cm-uri` mode the moment it sees `cmRead` among them. The
 * context index starts citing addresses the same run this tool appears — nothing else to wire.
 */
@Injectable()
export class CmResourceTools {
  constructor(private readonly resolver: CmResourceResolver) {}

  buildTools(ctx: CmResourceContext): Record<string, any> {
    if (!ctx?.orgId) return {};

    return {
      cmRead: tool({
        description: [
          'Read any Control Markets document by its `cm://` address. This is the single way to pull content — prefer it over any other tool.',
          'Addresses:',
          '  cm://skill/<bundle>                          → the skill plus the index of its atomic capabilities',
          '  cm://skill/<bundle>:<capability>             → ONE capability — prefer this, it returns only what that operation needs',
          '  cm://skill/<bundle>:<capability>/<file.md>   → a single embedded document of the skill',
          '  cm://source/<id>                             → a knowledge document, memory or exploration',
          '  cm://task/<id>                               → a task with its subtask checklist',
          '  cm://profile/<id>/context                    → the compiled context of another agent',
          'Executable scripts never come back as content: their workspace paths arrive under `scripts`, to run from disk.',
          'A response with `truncated: true` was cut at the size cap — ask for something narrower, do not guess the rest.',
        ].join('\n'),
        inputSchema: z.object({
          uri: z.string().describe('The `cm://` address, exactly as printed in your context index.'),
        }),
        execute: ({ uri }) => this.resolver.read(uri, ctx),
      }),

      getSkill: tool({
        description:
          'DEPRECATED — use `cmRead` with `cm://skill/<slug>` instead. Kept working for profiles and conversations that still name it. Loads a skill, or ONE atomic capability of it (`bundle:capability`). `file` narrows to a single document. Executable scripts come back as paths under `scripts`, never as content.',
        inputSchema: z.object({
          slugOrId: z.string().describe('Skill slug, capability slug (`bundle:capability`), or id.'),
          file: z.string().optional().describe('Optional: a single relative path of the skill, e.g. `reference/inbox-messaging.md`.'),
        }),
        execute: ({ slugOrId, file }) => this.resolver.read(buildCmUri('skill', slugOrId, file), ctx),
      }),

      getProfileSource: tool({
        description:
          'DEPRECATED — use `cmRead` with `cm://source/<id>` instead. Kept working for profiles and conversations that still name it. Loads the complete content of a knowledge source, memory or exploration by its ID.',
        inputSchema: z.object({ sourceId: z.string().describe('Linked source ID from the agent profile context index.') }),
        execute: ({ sourceId }) => this.resolver.read(buildCmUri('source', sourceId), ctx),
      }),
    };
  }
}
