import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { SkillsService } from '../agent-skills/services/skills.service';
import { SourcesService } from '../agent-tasks/services/sources.service';
import { AgentTasksService } from '../agent-tasks/services/agent-tasks.service';
import { AgenticProfileService } from '../agentic-profile/services/agentic-profile.service';
import { buildCmUri, CmUri, parseCmUri } from './cm-uri.util';
import { CM_RESOURCE_MAX_CHARS, CmResource, CmResourceChild, CmResourceContext } from './cm-resource.models';

/**
 * The one verb.
 *
 * Before this, asking for a document meant picking one of five call paths — `getProfileSource`,
 * `getSkill`, `agentic_profile_get_context`, `tasks_operation`, or reading the `.md` off disk — each
 * with its own contract, its own description to maintain, and its own place to forget the
 * organization filter. Only two of them existed in any given runtime, and none in all three.
 *
 * **The resolver orchestrates and validates; it does not reimplement.** `SkillsService`,
 * `SourcesService`, `AgentTasksService` and `AgenticProfileService` stay the owners of their
 * domains. What is centralized here is the addressing and the scoping — and the proof that the
 * wrapping worked is that `skills.service.spec.ts` never had to change.
 */
@Injectable()
export class CmResourceResolver {
  private readonly logger = new Logger('CmResourceResolver');

  constructor(
    private readonly skillsService: SkillsService,
    private readonly sourcesService: SourcesService,
    private readonly agentTasksService: AgentTasksService,
    private readonly agenticProfileService: AgenticProfileService,
  ) {}

  /**
   * Resolves one `cm://` address to its document.
   *
   * `ctx.orgId` is **required, not optional**, and that is the whole point of the signature. Almost
   * every service downstream declares `orgId?: string`, where passing `undefined` does not fail —
   * it quietly drops the tenant filter and answers with another organization's data. That default
   * is survivable inside a service whose callers are all in one module; it is not survivable at a
   * door reachable by a language model over four transports. So the door refuses to open without
   * one, and each branch below hands it to the owning service explicitly.
   */
  async read(uri: string, ctx: CmResourceContext): Promise<CmResource> {
    if (!ctx?.orgId) {
      throw new BadRequestException('cm:// requiere un contexto de organización; la lectura sin `orgId` no está permitida.');
    }
    const parsed = parseCmUri(uri);

    switch (parsed.kind) {
      case 'skill':
        return this.readSkill(parsed, ctx);
      case 'source':
        return this.readSource(parsed, ctx);
      case 'task':
        return this.readTask(parsed, ctx);
      case 'profile':
        return this.readProfileContext(parsed, ctx);
    }
  }

  // ─── skill ────────────────────────────────────────────────────────────────

  private async readSkill(parsed: CmUri, ctx: CmResourceContext): Promise<CmResource> {
    let resolved: Awaited<ReturnType<SkillsService['resolve']>>;
    try {
      resolved = await this.skillsService.resolve(parsed.ref, ctx.orgId, parsed.path);
    } catch (err: any) {
      // `SkillsService` answers a non-embedded file with a 404, which is accurate about storage but
      // useless as guidance: the file *does* exist, it is a script and lives on disk. Re-ask for the
      // bundle so the caller gets the path it has to run instead of concluding the file is missing.
      if (parsed.path && /not embedded|referenced by path only/i.test(String(err?.message))) {
        throw await this.describeNonEmbeddedFile(parsed, ctx, err);
      }
      throw err;
    }

    const children: CmResourceChild[] | undefined = resolved.capabilities?.length
      ? resolved.capabilities.map(capability => ({
          uri: buildCmUri('skill', capability.slug || capability.id),
          name: capability.name || capability.slug,
          description: capability.description,
        }))
      : undefined;

    return this.cap({
      uri: buildCmUri('skill', resolved.slug || parsed.ref, parsed.path),
      type: resolved.kind === 'capability' ? 'capability' : 'skill',
      name: resolved.name || resolved.slug,
      description: resolved.description,
      content: resolved.content || '',
      ...(children ? { children } : {}),
      ...(resolved.scripts?.length ? { scripts: resolved.scripts } : {}),
    });
  }

  private async describeNonEmbeddedFile(parsed: CmUri, ctx: CmResourceContext, original: Error): Promise<Error> {
    try {
      const bundle = await this.skillsService.resolve(parsed.ref, ctx.orgId);
      const root = bundle.relPath ? `${bundle.relPath.replace(/\/$/, '')}/` : '';
      return new BadRequestException(
        `\`${parsed.path}\` de ${parsed.uri} es un ejecutable, no un documento: no viaja como contenido. ` +
          `Su ruta en el workspace es \`${root}${parsed.path}\` — ejecutalo desde ahí. ` +
          `Ejecutables de esta skill: ${bundle.scripts?.length ? bundle.scripts.join(', ') : '(ninguno declarado)'}.`,
      );
    } catch {
      return original;
    }
  }

  // ─── source (knowledge, exploration, memory, org source) ──────────────────

  private async readSource(parsed: CmUri, ctx: CmResourceContext): Promise<CmResource> {
    // Two doors, in this order, both scoped by organization:
    //
    // 1. **Profile-linked** — when the run has a profile, ask the profile's own resolver. It derives
    //    the category from which of the profile's arrays holds the id (never from the caller) and it
    //    folds a skill's `aliasIds`, so a pre-migration id still resolves.
    // 2. **Organization-wide** — an address can also point at a source nobody linked to this profile.
    //    That is not a widening: `OrgSourceMentionResolver` already exposes every source of the
    //    organization to every chat of that organization. The boundary is the org, and it holds here.
    if (ctx.profileId) {
      try {
        const [linked] = await this.agenticProfileService.getLinkedContextResources(ctx.profileId, [{ id: parsed.ref }], ctx.orgId);
        if (linked && !linked.error) {
          return this.cap({
            uri: parsed.uri,
            type: 'source',
            name: linked.name || parsed.ref,
            description: linked.description,
            content: linked.content || '',
          });
        }
      } catch (err: any) {
        this.logger.debug(`profile-linked lookup failed for ${parsed.uri}: ${err?.message}`);
      }
    }

    const [source] = await this.sourcesService.findManyByIds([parsed.ref], ctx.orgId);
    if (!source) throw this.notFound(parsed);

    return this.cap({
      uri: parsed.uri,
      type: 'source',
      name: (source as any).name || parsed.ref,
      description: (source as any).description,
      content: (source as any).content || '',
    });
  }

  // ─── task ─────────────────────────────────────────────────────────────────

  private async readTask(parsed: CmUri, ctx: CmResourceContext): Promise<CmResource> {
    const rows = await this.agentTasksService.executeOperation({
      action: 'find',
      query: { id: parsed.ref, orgId: ctx.orgId },
      options: { limit: 1 },
    });
    const task = Array.isArray(rows) ? rows[0] : rows;
    if (!task) throw this.notFound(parsed);

    return this.cap({
      uri: parsed.uri,
      type: 'task',
      name: task.name || parsed.ref,
      description: task.description,
      content: this.renderTask(task),
    });
  }

  /**
   * A task is not a document, so it gets composed into one: the state a reader needs to act
   * (`status`, `priority`, `#number`) as a header, the body, and the checklist. The subtasks are the
   * reason `cm://task/<id>` exists at all instead of pointing people at `tasks_operation` — the
   * checklist is what says how far along the work is.
   */
  private renderTask(task: any): string {
    const header = [
      task.taskNumber != null ? `- Número: \`#${task.taskNumber}\`` : null,
      task.status ? `- Estado: \`${task.status}\`` : null,
      task.priority != null ? `- Prioridad: \`${task.priority}\`` : null,
      task.sourceUrl ? `- Ruta/URL: ${task.sourceUrl}` : null,
    ].filter(Boolean);

    const subtasks = (task.subtasks || []) as any[];
    const checklist = subtasks.length
      ? [
          '',
          `## Subtareas (${subtasks.filter(s => s.status === 'done').length}/${subtasks.length})`,
          '',
          ...subtasks.map(s => `- [${s.status === 'done' ? 'x' : ' '}] ${s.name}${s.description ? ` — ${s.description}` : ''}`),
        ]
      : [];

    return [`# ${task.name || 'Tarea'}`, '', ...header, '', task.content || '*(Sin contenido)*', ...checklist].join('\n');
  }

  // ─── profile context ──────────────────────────────────────────────────────

  private async readProfileContext(parsed: CmUri, ctx: CmResourceContext): Promise<CmResource> {
    try {
      // No `runtime` argument on purpose: the reader here is *another* agent asking about a profile
      // that is not its own, and the runtime of the asker says nothing about how that other profile's
      // documents should be addressed. Legacy rendering keeps the answer byte-identical to what
      // `agentic_profile_get_context` has always returned.
      const content = await this.agenticProfileService.composeFullContext(parsed.ref, ctx.orgId);
      return this.cap({ uri: parsed.uri, type: 'profile-context', name: `Contexto de perfil ${parsed.ref}`, content });
    } catch (err: any) {
      // `composeFullContext` throws a bare `Error` when the profile is not found *or* not in the
      // organization — indistinguishable on purpose, and mapped here to the same 404 as everything
      // else so no door turns into an existence oracle over other tenants.
      if (/not found/i.test(String(err?.message))) throw this.notFound(parsed);
      throw err;
    }
  }

  // ─── shared ───────────────────────────────────────────────────────────────

  /**
   * A miss and a cross-organization hit are the same answer, deliberately.
   *
   * Saying "this exists but belongs to someone else" is an existence oracle over every tenant's
   * data — the same reason `MentionError` has no `unauthorized` member. The miss is logged
   * server-side, where it is useful, and never differentiated in the response.
   */
  private notFound(parsed: CmUri): NotFoundException {
    this.logger.warn(`cm:// miss — ${parsed.uri} no existe en la organización que preguntó`);
    return new NotFoundException(`${parsed.uri} no existe o no pertenece a esta organización.`);
  }

  /** Applies the size cap, marking the cut instead of returning a quietly incomplete document. */
  private cap(resource: CmResource): CmResource {
    const content = resource.content || '';
    if (content.length <= CM_RESOURCE_MAX_CHARS) return resource;

    const kept = content.slice(0, CM_RESOURCE_MAX_CHARS);
    return {
      ...resource,
      truncated: true,
      content:
        `${kept}\n\n> ⚠️ **Contenido truncado** en ${CM_RESOURCE_MAX_CHARS} de ${content.length} caracteres. ` +
        `Faltan ${content.length - CM_RESOURCE_MAX_CHARS}. ` +
        (resource.type === 'skill'
          ? 'Pedí una capacidad concreta (`cm://skill/<bundle>:<capacidad>`) o un archivo suelto para recibirlo completo.'
          : 'No supongas qué dice el resto: decí que lo recibiste cortado.'),
    };
  }
}
