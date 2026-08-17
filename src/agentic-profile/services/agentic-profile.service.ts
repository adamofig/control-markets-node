import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import mongoose, { Model } from 'mongoose';
import { EntityCommunicationService, MongoService } from '@dataclouder/nest-mongo';
import { AgenticProfileDocument, AgenticProfileEntity } from '../schemas/agentic-profile.schema';
import { AgentCardService } from '@dataclouder/nest-agent-cards';
import { SourcesService } from '../../agent-tasks/services/sources.service';
import { SkillsService } from '../../agent-skills/services/skills.service';
import { AgentTasksService } from '../../agent-tasks/services/agent-tasks.service';
import { mergeMarkdownSubtasks, parseSubtasksFromMarkdown } from '../../agent-tasks/services/subtask-markdown.util';
import { normalizeTaskPriority, DEFAULT_TASK_PRIORITY, TASK_PRIORITY_LABELS, TASK_STATUS_MARKS } from '../../agent-tasks/models/classes';
import {
  AgenticContextLevel,
  AgenticLinkedResourceKind,
  IAgenticProfileAcpConfig,
  IAgenticProfileSkill,
  ILinkedContextResource,
  ISkillCatalogItem,
  ISkillLinkInput,
} from '../models/agentic-profile.models';
import { asAcpEngine, asReasoningEffort } from '../../common/acp-engines';
import { buildFingerprint, hashContent } from './sync-hash.util';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { WIKI_PROFILE_CHANGED } from '../../wiki-sync/wiki-sync.events';

interface SyncStats {
  created: number;
  updated: number;
  skipped: number;
  /** Skill folders persisted into the `skills` collection, and their atomic capabilities */
  bundles?: number;
  capabilities?: number;
}

@Injectable()
export class AgenticProfileService extends EntityCommunicationService<AgenticProfileDocument> {
  constructor(
    @InjectModel(AgenticProfileEntity.name)
    agenticProfileModel: Model<AgenticProfileDocument>,
    mongoService: MongoService,
    private readonly agentCardService: AgentCardService,
    private readonly sourcesService: SourcesService,
    private readonly agentTasksService: AgentTasksService,
    private readonly eventEmitter: EventEmitter2,
    // Only the skill-bundle branch of the markdown sync touches this, so the specs that build the
    // service positionally pass a stub for it.
    private readonly skillsService: SkillsService
  ) {
    super(agenticProfileModel, mongoService);
  }

  async findByIdForOrganization(profileId: string, orgId: string): Promise<AgenticProfileDocument | null> {
    const identityClauses: any[] = [{ id: profileId }];
    if (mongoose.Types.ObjectId.isValid(profileId)) identityClauses.push({ _id: new mongoose.Types.ObjectId(profileId) });
    return this.genericModel.findOne({ orgId, $or: identityClauses }).exec();
  }

  /**
   * `profile.tasks[]` keeps a denormalized copy of each task's name/status/priority, written by the
   * markdown sync and by the profile form. Editing a task in `/page/tasks` writes `agent_tasks` only,
   * so that copy goes stale and the profile detail renders an old priority. Refresh it at read time.
   *
   * Cost is one extra query for the whole response, not one per profile: every ref of every profile
   * is resolved in a single `_id: { $in }` lookup (primary index) projected to five fields and read
   * with `.lean()`. No refs, no query. Refs whose task was deleted or belongs to another org keep
   * their stored snapshot untouched — this hydrates, it never prunes.
   */
  async hydrateTaskRefs<T extends { tasks?: any[]; orgId?: string }>(profiles: T[]): Promise<T[]> {
    const ids = profiles.flatMap(profile => (profile?.tasks || []).map((ref: any) => ref?.id).filter(Boolean));
    if (ids.length === 0) return profiles;

    const liveTasks = await this.agentTasksService.findRefFieldsByIds(ids);
    const liveById = new Map(liveTasks.map(task => [task.id || task._id?.toString(), task]));

    for (const profile of profiles) {
      if (!profile?.tasks?.length) continue;
      profile.tasks = profile.tasks.map((ref: any) => {
        const live = ref?.id ? liveById.get(ref.id) : undefined;
        if (!live) return ref;
        // Never let a task from another organization overwrite this profile's snapshot.
        if (profile.orgId && live.orgId && live.orgId !== profile.orgId) return ref;
        return {
          ...ref,
          name: live.name ?? ref.name,
          status: live.status ?? ref.status,
          priority: live.priority ?? ref.priority,
          updatedAt: live.updatedAt ?? ref.updatedAt,
        };
      });
    }
    return profiles;
  }

  /**
   * Updates ONLY the Section 8 live briefing (owner-written text) of a profile and notifies
   * the wiki write-back so the change mirrors into the local `.md` (Section 8) when running locally.
   * Scoped by orgId for multi-tenant safety; returns the persisted value.
   */
  async updateLiveBriefing(id: string, liveBriefing: string, orgId?: string): Promise<{ liveBriefing: string }> {
    const query: any = { id };
    if (orgId) query.orgId = orgId;
    const value = liveBriefing ?? '';
    await this.genericModel.updateOne(query, { $set: { liveBriefing: value } }).exec();
    this.eventEmitter.emit(WIKI_PROFILE_CHANGED, { id });
    return { liveBriefing: value };
  }

  /**
   * Updates ONLY the profile's default ACP engine/model (`acpConfig`) — the seed for new chats and
   * cron wake-ups. Lets the detail page edit it without round-tripping the whole entity form.
   *
   * Every field is narrowed against the canonical unions before writing, because `updateOne` does
   * not run Mongoose validators: an unknown engine would otherwise reach the dispatcher. `model`
   * stays free text (the adapter's live `configOptions` are the real authority) but is trimmed and
   * only kept when it belongs to a chosen engine — a model without an engine is unresolvable.
   */
  async updateAcpConfig(id: string, config: IAgenticProfileAcpConfig | undefined, orgId?: string): Promise<IAgenticProfileAcpConfig> {
    const query: any = { id };
    if (orgId) query.orgId = orgId;

    const defaultEngine = asAcpEngine(config?.defaultEngine);
    const sanitized: IAgenticProfileAcpConfig = {};
    if (defaultEngine) {
      sanitized.defaultEngine = defaultEngine;
      const model = typeof config?.defaultModel === 'string' ? config.defaultModel.trim() : '';
      if (model) sanitized.defaultModel = model;
      const effort = asReasoningEffort(config?.reasoningEffort);
      if (effort) sanitized.reasoningEffort = effort;
    }

    // An empty object is unset rather than stored: absence is what makes the server default apply.
    const update = Object.keys(sanitized).length ? { $set: { acpConfig: sanitized } } : { $unset: { acpConfig: '' } };
    await this.genericModel.updateOne(query, update).exec();
    return sanitized;
  }

  /**
   * Upserts a source-like entity (knowledge, skill, exploration or memory) from a profile link.
   * Delta-sync contract: a link may arrive WITHOUT `content` when the CLI matched its local
   * hash against the sync manifest — in that case the stored entity is reused untouched.
   * When content is present, the write is skipped if the stored contentHash already matches.
   */
  private async upsertSourceFromLink(
    link: any,
    kind: 'knowledge' | 'skill' | 'exploration' | 'memory',
    tag: string | undefined,
    orgId: string,
    userEmail: string,
    stats: SyncStats,
    workspaceId?: string
  ): Promise<any> {
    const query = { sourceUrl: link.url, orgId };
    let entity = await this.sourcesService.executeOperation({ action: 'findOne', query });

    const hasContent = link.content !== undefined && link.content !== null;
    const fingerprint = workspaceId && link.relPath ? buildFingerprint(workspaceId, link.relPath) : undefined;
    const contractFields: any = fingerprint ? { fingerprint, workspaceId, relPath: link.relPath, kind } : { kind };

    if (entity && !hasContent) {
      // CLI skipped the file body because the manifest hash matched. Backfill the
      // fingerprint contract fields if they are new/changed — content stays untouched.
      if (fingerprint && entity.fingerprint !== fingerprint) {
        await this.sourcesService.executeOperation({
          action: 'updateOne',
          query: { id: entity.id },
          payload: { $set: contractFields },
        });
      }
      stats.skipped++;
      return entity;
    }

    const contentHash = hashContent(hasContent ? link.content : link.description || '');
    if (entity && entity.contentHash === contentHash && entity.name === link.label && entity.description === link.description && (!fingerprint || entity.fingerprint === fingerprint)) {
      stats.skipped++;
      return entity;
    }

    const sourceData: any = {
      orgId,
      name: link.label,
      description: link.description,
      sourceUrl: link.url,
      type: 'document',
      content: hasContent ? link.content : link.description,
      status: 'active',
      contentHash,
      ...contractFields,
    };
    if (tag) {
      sourceData.tag = tag;
    }

    if (entity) {
      await this.sourcesService.executeOperation({
        action: 'updateOne',
        query: { id: entity.id },
        payload: { $set: sourceData },
      });
      entity = await this.sourcesService.executeOperation({
        action: 'findOne',
        query: { id: entity.id },
      });
      stats.updated++;
    } else {
      sourceData.auditable = { createdBy: userEmail, updatedBy: userEmail };
      entity = await this.sourcesService.executeOperation({
        action: 'create',
        payload: sourceData,
      });
      stats.created++;
    }
    return entity;
  }

  /**
   * Links of one profile collection, preferring the structured `collections.<key>` array — built by
   * the CLI from the YAML frontmatter — over the legacy `sections[n].links` produced by parsing the
   * numbered markdown headings with regex.
   *
   * Both carry the same link contract (`label`, `url`, `description`, optional `content`/`relPath`),
   * so only the origin of the array changes; nothing downstream needs to know which one was used.
   * The fallback is what lets profiles migrate one at a time instead of in a flag day.
   */
  private resolveCollectionLinks(payload: any, sections: any[], key: string, legacySectionNumber: number): any[] {
    const structured = payload?.collections?.[key];
    if (Array.isArray(structured)) return structured;
    const section = (sections || []).find((s: any) => s.number === legacySectionNumber);
    return section?.links || [];
  }

  /**
   * Every skill source of the organization, for the UI catalog that attaches skills to a profile.
   * Read-only and org-scoped: it never reveals which other profiles use a skill.
   */
  async listSkillCatalog(orgId: string): Promise<ISkillCatalogItem[]> {
    if (!orgId) return [];
    // Bundles only. A capability is reachable through its bundle (and through `@bundle:capability`);
    // listing all of them here would turn a 3-row picker into a 20-row one for no added choice — the
    // profile links a *skill*, and which capability applies is decided at fetch time.
    const rows = await this.skillsService.listCatalog(orgId);
    return (rows || [])
      .map(row => ({
        id: row.id,
        name: row.name,
        description: row.description,
        url: row.relPath,
        updatedAt: row.updatedAt,
        capabilities: row.capabilities,
      }))
      .filter((row: ISkillCatalogItem) => !!row.id);
  }

  /**
   * Replaces the profile's skill refs from the UI catalog.
   *
   * The client sends ids and flags only — name, description and url are re-read from the source
   * entities of the same org, so a caller cannot inject a label or reach a skill of another tenant
   * (unknown ids are dropped silently rather than failing the whole save).
   *
   * `origin` is preserved for skills the markdown already declares, because the `.md` remains their
   * source of truth; anything else is stored as `platform` so the next sync leaves it alone.
   */
  async updateSkillLinks(id: string, skills: ISkillLinkInput[] | undefined, orgId?: string): Promise<IAgenticProfileSkill[]> {
    const query: any = { id };
    if (orgId) query.orgId = orgId;
    const profile = await this.genericModel.findOne(query).exec();
    if (!profile) {
      throw new NotFoundException(`AgenticProfile with ID ${id} not found`);
    }

    const requested = (skills || []).filter(skill => skill?.id);
    const uniqueIds = [...new Set(requested.map(skill => skill.id))];
    const entities = uniqueIds.length ? await this.skillsService.findManyByIds(uniqueIds, profile.orgId) : [];
    // A skill absorbed by the migration answers to its folded `aliasIds` too, so index both — a
    // profile saved before the migration sends the old id and must still resolve.
    const entityById = new Map<string, any>();
    for (const entity of entities as any[]) {
      const canonicalId = entity.id || entity._id?.toString();
      entityById.set(canonicalId, entity);
      for (const alias of entity.aliasIds || []) entityById.set(alias, entity);
    }

    const previousById = new Map(
      (profile.skills || [])
        .map((skill: any) => (typeof skill?.toObject === 'function' ? skill.toObject() : skill))
        .filter((skill: any) => skill?.id)
        .map((skill: any) => [skill.id, skill])
    );

    const seen = new Set<string>();
    const resolved: IAgenticProfileSkill[] = [];
    for (const skill of requested) {
      if (seen.has(skill.id)) continue;
      const entity: any = entityById.get(skill.id);
      if (!entity) continue;
      seen.add(skill.id);
      const previous: any = previousById.get(skill.id);
      // Normalize to the canonical id: an alias resolves today, but storing it would keep the old
      // reference alive forever instead of healing it on the first save.
      resolved.push({
        id: entity.id || entity._id?.toString(),
        name: entity.name,
        description: entity.description,
        url: entity.relPath || entity.sourceUrl,
        origin: previous?.origin === 'markdown' ? 'markdown' : 'platform',
        enabled: skill.enabled !== false,
      });
    }

    profile.skills = resolved;
    await profile.save();
    return resolved;
  }

  async syncFromMarkdown(payload: any, orgId: string, userEmail: string): Promise<any> {
    const { agentCardId, agenticProfileId, agentName, agentTitle, agentDescription, agentDomain, sections, workspaceId, profileRelPath } = payload;

    if (!agentCardId) {
      throw new Error('agentCardId is required in the frontmatter YAML');
    }

    // 1. Find and update AgentCard identity & instructions (Section 1)
    const agentCard = await this.agentCardService.findById(agentCardId);
    if (!agentCard) {
      throw new Error(`AgentCard with ID ${agentCardId} not found in database`);
    }

    const stats: SyncStats = { created: 0, updated: 0, skipped: 0 };

    // Find section 1 content
    const sec1 = sections.find((s: any) => s.number === 1);
    const instructions = sec1 ? sec1.content : '';

    // Skip the agent card write when identity/instructions did not change (delta sync)
    const currentInstructions = agentCard.characterCard?.data?.instructions || '';
    const currentCardName = agentCard.characterCard?.data?.name || '';
    if (currentInstructions !== instructions || currentCardName !== agentName) {
      const cardUpdates: any = {};
      if (agentCard.characterCard) {
        cardUpdates.characterCard = {
          ...agentCard.characterCard,
          data: {
            ...(agentCard.characterCard.data || {}),
            name: agentName,
            instructions,
          },
        };
      } else {
        cardUpdates.characterCard = {
          data: {
            name: agentName,
            instructions,
          },
        };
      }

      await this.agentCardService.executeOperation({
        action: 'updateOne',
        query: { id: agentCardId },
        payload: { $set: cardUpdates },
      });
      stats.updated++;
    } else {
      stats.skipped++;
    }

    // 2. Find or create AgenticProfile
    let profile = null;
    if (agenticProfileId && mongoose.Types.ObjectId.isValid(agenticProfileId)) {
      profile = await this.genericModel
        .findOne({
          $or: [{ id: agenticProfileId }, { _id: new mongoose.Types.ObjectId(agenticProfileId as string) }],
          orgId,
        })
        .exec();
    }
    if (!profile) {
      profile = await this.genericModel.findOne({ 'agentCard.id': agentCardId, orgId }).exec();
    }

    if (!profile) {
      const newProfile = new this.genericModel({
        orgId,
        name: `${agentName} Profile`,
        title: agentTitle,
        description: agentDescription || '',
        domain: agentDomain || '',
        agentCard: {
          id: agentCardId,
          name: agentName,
          imageUrl: agentCard.assets?.image?.url || '',
        },
        sources: [],
        skills: [],
        tasks: [],
        memories: [],
        explorations: [],
        auditable: {
          createdBy: userEmail,
          updatedBy: userEmail,
        },
      });
      profile = await newProfile.save();
    } else {
      profile.name = `${agentName} Profile`;
      profile.title = agentTitle;
      profile.description = agentDescription || '';
      profile.domain = agentDomain || '';
      profile.agentCard = {
        id: agentCardId,
        name: agentName,
        imageUrl: agentCard.assets?.image?.url || '',
      };
      profile.auditable = {
        ...profile.auditable,
        updatedBy: userEmail,
      };
    }
    if (workspaceId) {
      profile.workspaceId = workspaceId;
    }
    if (profileRelPath) {
      profile.relPath = profileRelPath; // anchor for local write-backs (Section 6 checkboxes, new task files)
    }

    // 3. Sync Knowledge Sources (Section 3)
    const sec3 = sections.find((s: any) => s.number === 3);
    const resolvedSources = [];
    if (sec3 && sec3.links) {
      for (const link of sec3.links) {
        const sourceEntity = await this.upsertSourceFromLink(link, 'knowledge', undefined, orgId, userEmail, stats, workspaceId);

        resolvedSources.push({
          id: sourceEntity.id || sourceEntity._id?.toString(),
          name: sourceEntity.name,
          type: sourceEntity.type,
          url: sourceEntity.sourceUrl,
          description: sourceEntity.description,
        });
      }
    }
    profile.sources = resolvedSources;

    // 4. Sync Skills — YAML frontmatter `skills[]` when present, legacy Section 4 otherwise.
    const skillLinks = this.resolveCollectionLinks(payload, sections, 'skills', 4);
    const previousSkills: any[] = (profile.skills || []).map((skill: any) => (typeof skill?.toObject === 'function' ? skill.toObject() : skill));
    const previousSkillById = new Map(previousSkills.filter((skill: any) => skill?.id).map((skill: any) => [skill.id, skill]));
    const resolvedSkills = [];
    // Bundle ids, keyed by the link url, so the write-back can hand `skillId` back to the `.md`.
    const bundleIdByUrl = new Map<string, string>();
    for (const link of skillLinks) {
      // Skills live in their own collection now — `upsertSourceFromLink` is no longer called for
      // them, so `sources` stops accumulating skill rows.
      //
      // A skill declared without an expandable bundle (a link the CLI could not read, or an older
      // client that predates this contract) is skipped rather than silently written to `sources`:
      // resurrecting the old storage for it would put the profile back on the path the migration
      // just cleaned up, and the loud warning is what surfaces the stale client.
      if (!link.bundle?.slug) {
        console.warn(`Skill link "${link.url}" arrived without a bundle — skipped. Re-run sync-agent-card.js from an up-to-date checkout.`);
        stats.skipped++;
        continue;
      }

      let skillId: string;
      try {
        const result = await this.skillsService.upsertBundle(link.bundle, orgId, workspaceId);
        skillId = result.skillId;
        bundleIdByUrl.set(link.url, skillId);
        stats.bundles = (stats.bundles || 0) + 1;
        stats.capabilities = (stats.capabilities || 0) + result.capabilities;
        if (result.created) stats.created++;
        else stats.updated++;
      } catch (err) {
        // A malformed bundle must not abort the whole profile sync — every other section is valid.
        console.error(`Skill bundle "${link.bundle.slug}" failed to sync: ${err.message}`);
        continue;
      }

      resolvedSkills.push({
        id: skillId,
        name: link.bundle.name || link.label,
        description: link.bundle.description || link.description,
        url: link.url,
        origin: 'markdown' as const,
        // The file wins when it states `enabled`; otherwise a UI toggle survives the next sync.
        enabled: link.enabled !== undefined ? !!link.enabled : (previousSkillById.get(skillId)?.enabled ?? true),
      });
    }
    // Skills attached from the UI catalog have no declaring file — rewriting the array wholesale
    // would silently undo them, so they are carried over untouched.
    const platformSkills = previousSkills.filter((skill: any) => skill?.origin === 'platform' && !resolvedSkills.some(resolved => resolved.id === skill.id));
    profile.skills = [...resolvedSkills, ...platformSkills];

    // 4b. Prepare skill write-backs for local frontmatter updates.
    // Keyed by url, never by index: a skill can be skipped or fail, and positional pairing would
    // then write one skill's id into a different skill's file.
    const skillWriteBacks = [];
    for (const link of skillLinks) {
      const skillId = bundleIdByUrl.get(link.url);
      if (!skillId) continue;
      skillWriteBacks.push({
        url: link.url,
        label: link.label,
        // `sourceId` is kept for backwards compatibility with `.md` files already carrying it; both
        // now hold the same value, since the migration preserved the id.
        sourceId: skillId,
        skillId,
        orgId,
      });
    }

    // 5. Sync Explorations (Section 5)
    const sec5 = sections.find((s: any) => s.number === 5);
    const resolvedExplorations = [];
    if (sec5 && sec5.links) {
      for (const link of sec5.links) {
        const explorationEntity = await this.upsertSourceFromLink(link, 'exploration', 'exploration', orgId, userEmail, stats, workspaceId);

        resolvedExplorations.push({
          id: explorationEntity.id || explorationEntity._id?.toString(),
          name: explorationEntity.name,
          description: explorationEntity.description,
          enabled: true,
        });
      }
    }
    profile.explorations = resolvedExplorations;

    // 5b. Prepare exploration write-backs for local frontmatter updates
    const explorationWriteBacks = [];
    if (sec5 && sec5.links) {
      for (let i = 0; i < sec5.links.length; i++) {
        const link = sec5.links[i];
        const exploration = resolvedExplorations[i];
        if (exploration && exploration.id) {
          explorationWriteBacks.push({
            url: link.url,
            label: link.label,
            sourceId: exploration.id,
            orgId,
          });
        }
      }
    }

    // 6. Sync Tasks (Section 6)
    const sec6 = sections.find((s: any) => s.number === 6);
    const resolvedTasks = [];
    const taskWriteBacks = []; // Return list of tasks to update local frontmatter

    if (sec6 && sec6.links) {
      for (const link of sec6.links) {
        let taskEntity = null;
        if (link.taskId) {
          taskEntity = await this.agentTasksService.findOne(link.taskId);
        }

        const taskStatus = link.status || 'pending';
        // `priority` is an auto-frontmatter key (excluded from the content hash), so it always
        // travels on the link — exactly like `status`. Missing/invalid → keep whatever the DB has.
        const taskPriority = normalizeTaskPriority(link.priority);
        const hasContent = link.content !== undefined && link.content !== null;
        const taskFingerprint = workspaceId && link.relPath ? buildFingerprint(workspaceId, link.relPath) : undefined;
        const taskContractFields: any = taskFingerprint ? { fingerprint: taskFingerprint, workspaceId, relPath: link.relPath } : {};

        if (taskEntity && !hasContent) {
          // Delta sync: content unchanged per manifest. Status still flows from the local
          // checkbox/frontmatter, so apply it alone when it differs.
          const fingerprintChanged = taskFingerprint && taskEntity.fingerprint !== taskFingerprint;
          const priorityChanged = taskPriority !== undefined && taskPriority !== taskEntity.priority;
          if (taskStatus !== taskEntity.status || priorityChanged || fingerprintChanged) {
            await this.agentTasksService.executeOperation({
              action: 'updateOne',
              query: { id: link.taskId },
              payload: { $set: { status: taskStatus, ...(taskPriority !== undefined ? { priority: taskPriority } : {}), ...taskContractFields } },
            });
            taskEntity = await this.agentTasksService.executeOperation({
              action: 'findOne',
              query: { id: link.taskId },
            });
            stats.updated++;
          } else {
            stats.skipped++;
          }
        } else {
          const fileContent = link.content;
          const contentHash = hashContent(hasContent ? fileContent : link.description || '');

          if (
            taskEntity &&
            taskEntity.contentHash === contentHash &&
            taskEntity.status === taskStatus &&
            (taskPriority === undefined || taskEntity.priority === taskPriority) &&
            taskEntity.name === link.label &&
            taskEntity.description === link.description &&
            (!taskFingerprint || taskEntity.fingerprint === taskFingerprint)
          ) {
            stats.skipped++;
          } else {
            const taskData: any = {
              orgId,
              name: link.label,
              description: link.description,
              content: fileContent || link.description,
              sourceUrl: link.url,
              status: taskStatus,
              ...(taskPriority !== undefined ? { priority: taskPriority } : {}),
              contentHash,
              ...taskContractFields,
              assignedType: 'agent',
              assignedTo: {
                id: agentCardId,
                name: agentName,
                description: agentTitle,
              },
            };

            // Extract `- [ ]` checkboxes from the task markdown and merge them as structured subtasks.
            // Platform-completed subtasks keep their done status even if the local file is stale.
            const parsedSubtasks = parseSubtasksFromMarkdown(fileContent);
            if (parsedSubtasks.length > 0 || taskEntity?.subtasks?.length) {
              taskData.subtasks = mergeMarkdownSubtasks(taskEntity?.subtasks || [], parsedSubtasks);
            }

            if (taskEntity) {
              await this.agentTasksService.executeOperation({
                action: 'updateOne',
                query: { id: link.taskId },
                payload: { $set: taskData },
              });
              taskEntity = await this.agentTasksService.executeOperation({
                action: 'findOne',
                query: { id: link.taskId },
              });
              stats.updated++;
            } else {
              taskData.auditable = { createdBy: userEmail, updatedBy: userEmail };
              taskEntity = await this.agentTasksService.executeOperation({
                action: 'create',
                payload: taskData,
              });
              stats.created++;
            }
          }
        }

        const resolvedId = taskEntity.id || taskEntity._id?.toString();

        resolvedTasks.push({
          id: resolvedId,
          name: taskEntity.name,
          status: taskEntity.status,
          priority: taskEntity.priority,
          updatedAt: (taskEntity as any).updatedAt,
        });

        // Add to write-back list
        taskWriteBacks.push({
          url: link.url,
          label: link.label,
          taskId: resolvedId,
          orgId,
          status: taskEntity.status,
          priority: taskEntity.priority,
        });
      }
    }
    profile.tasks = resolvedTasks;

    // 8. Sync Live Briefing (Section 8) — human-written, stored directly as text
    const sec8 = sections.find((s: any) => s.number === 8);
    if (sec8 && sec8.content) {
      profile.liveBriefing = sec8.content;
    }

    // 7. Sync Memories (Section 7)
    const sec7 = sections.find((s: any) => s.number === 7);
    const resolvedMemories = [];
    if (sec7 && sec7.links) {
      for (const link of sec7.links) {
        const memoryEntity = await this.upsertSourceFromLink(link, 'memory', 'memory', orgId, userEmail, stats, workspaceId);

        resolvedMemories.push({
          id: memoryEntity.id || memoryEntity._id?.toString(),
          name: memoryEntity.name,
          description: memoryEntity.description,
          enabled: true,
        });
      }
    }
    profile.memories = resolvedMemories;

    // 7b. Prepare memory write-backs for local frontmatter updates
    const memoryWriteBacks = [];
    if (sec7 && sec7.links) {
      for (let i = 0; i < sec7.links.length; i++) {
        const link = sec7.links[i];
        const memory = resolvedMemories[i];
        if (memory && memory.id) {
          memoryWriteBacks.push({
            url: link.url,
            label: link.label,
            sourceId: memory.id,
            orgId,
          });
        }
      }
    }

    // Save profile updates
    await profile.save();

    return {
      success: true,
      profileId: profile.id || profile._id?.toString(),
      agentCardId,
      tasks: taskWriteBacks,
      skills: skillWriteBacks,
      memories: memoryWriteBacks,
      explorations: explorationWriteBacks,
      stats,
    };
  }

  /**
   * Sync manifest for the delta push: maps every synced file of a profile (by its sourceUrl,
   * the relative path as written in the profile markdown) to its stored contentHash so the CLI
   * can send only the files whose local hash differs.
   */
  async getSyncManifest(profileId: string, orgId?: string): Promise<any> {
    const query: any = {
      $or: [{ id: profileId }, { _id: mongoose.Types.ObjectId.isValid(profileId) ? new mongoose.Types.ObjectId(profileId) : null }].filter(q => q._id !== null),
    };
    if (orgId) {
      query.orgId = orgId;
    }
    const profile = await this.genericModel.findOne(query).exec();
    if (!profile) {
      throw new Error(`AgenticProfile with ID ${profileId} not found`);
    }

    const sourceIds = [...(profile.sources || []), ...(profile.skills || []), ...(profile.explorations || []), ...(profile.memories || [])].map((s: any) => s.id).filter(Boolean);
    const taskIds = (profile.tasks || []).map((t: any) => t.id).filter(Boolean);

    const [sources, tasks] = await Promise.all([
      sourceIds.length > 0 ? this.sourcesService.findManyByIds(sourceIds) : Promise.resolve([]),
      taskIds.length > 0 ? this.agentTasksService.executeOperation({ action: 'find', query: { id: { $in: taskIds }, orgId: profile.orgId } }) : Promise.resolve([]),
    ]);

    return {
      profileId: profile.id || profile._id?.toString(),
      sources: (sources || []).map((s: any) => ({
        url: s.sourceUrl,
        sourceId: s.id || s._id?.toString(),
        kind: s.kind || null,
        contentHash: s.contentHash || null,
      })),
      tasks: (tasks || []).map((t: any) => ({
        url: t.sourceUrl,
        taskId: t.id || t._id?.toString(),
        status: t.status,
        priority: t.priority ?? null,
        contentHash: t.contentHash || null,
      })),
    };
  }

  async composeFullContext(profileId: string, orgId?: string, levelOverride?: AgenticContextLevel): Promise<string> {
    const query: any = {
      $or: [{ id: profileId }, { _id: mongoose.Types.ObjectId.isValid(profileId) ? new mongoose.Types.ObjectId(profileId) : null }].filter(q => q._id !== null),
    };
    if (orgId) {
      query.orgId = orgId;
    }
    const profile = await this.genericModel.findOne(query).exec();
    if (!profile) {
      throw new Error(`AgenticProfile with ID ${profileId} not found`);
    }
    const level: AgenticContextLevel = levelOverride ?? profile.contextLevel ?? 'basic';

    // Fetch AgentCard instructions
    let instructions = '';
    let agentName = profile.agentCard?.name || 'Agent';
    if (profile.agentCard?.id) {
      const agentCard = await this.agentCardService.findById(profile.agentCard.id);
      if (agentCard?.characterCard?.data?.instructions) {
        instructions = agentCard.characterCard.data.instructions;
      }
      if (agentCard?.characterCard?.data?.name) {
        agentName = agentCard.characterCard.data.name;
      }
    }

    // Get arrays of IDs
    const sourceIds = (profile.sources || []).map((s: any) => s.id);
    const skillIds = (profile.skills || []).filter((s: any) => s.enabled !== false).map((s: any) => s.id);
    const taskIds = (profile.tasks || []).map((t: any) => t.id);
    const memoryIds = (profile.memories || []).filter((m: any) => m.enabled !== false).map((m: any) => m.id);
    const explorationIds = (profile.explorations || []).filter((e: any) => e.enabled !== false).map((e: any) => e.id);

    // Query Source, Skill, Task, Memory, and Exploration entities
    const [sources, skills, tasks, memories, explorations] = await Promise.all([
      sourceIds.length > 0 ? this.sourcesService.findManyByIds(sourceIds, orgId) : Promise.resolve([]),
      skillIds.length > 0 ? this.skillsService.findManyByIds(skillIds, orgId) : Promise.resolve([]),
      taskIds.length > 0
        ? this.agentTasksService.executeOperation({
            action: 'find',
            query: { id: { $in: taskIds }, ...(orgId ? { orgId } : {}) },
          })
        : Promise.resolve([]),
      memoryIds.length > 0 ? this.sourcesService.findManyByIds(memoryIds, orgId) : Promise.resolve([]),
      explorationIds.length > 0 ? this.sourcesService.findManyByIds(explorationIds, orgId) : Promise.resolve([]),
    ]);

    // Build Markdown Output
    let md = `---\n`;
    md += `agentCardId: "${profile.agentCard?.id || ''}"\n`;
    md += `orgId: "${profile.orgId || ''}"\n`;
    md += `name: "${agentName}"\n`;
    md += `title: "${profile.title || ''}"\n`;
    md += `description: "${profile.description || ''}"\n`;
    md += `agenticProfileId: "${profile.id || profile._id?.toString() || ''}"\n`;
    md += `contextLevel: "${level}"\n`;
    md += `---\n\n`;

    md += `# ${agentName} — ${profile.title || ''}\n\n`;

    md += `## 1. Identidad y Persona y Responsabilidades\n\n`;
    md += instructions ? `${instructions}\n\n` : `*(No instructions provided)*\n\n`;

    md += `---\n\n`;

    md += `## 2. Conceptos Clave del Dominio y Reglas (Domain Context)\n\n`;
    md += profile.domain ? `${profile.domain}\n\n` : `*(Refiérase a los documentos de conocimiento y skills vinculados a continuación para reglas operativas específicas)*\n\n`;

    md += `---\n\n`;

    md += `## 3. Conocimiento Base e Índice de Referencias (Knowledge Reference)\n\n`;
    if (sources && sources.length > 0) {
      for (const src of sources) {
        md += `### Documento: ${src.name || 'Sin título'}\n`;
        if (src.description) {
          md += `> Descripción: ${src.description}\n\n`;
        }
        md += `- ID: \`${src.id || src._id?.toString() || ''}\`\n`;
        if (src.sourceUrl) md += `- Ruta/URL: ${src.sourceUrl}\n`;
        md += `\n`;
        if (level === 'full') md += src.content ? `${src.content}\n\n` : `*(Contenido vacío)*\n\n`;
        else md += `> Contenido disponible bajo demanda con \`getProfileSource\` usando el ID anterior.\n\n`;
        md += `---\n\n`;
      }
    } else {
      md += `*(No hay fuentes de conocimiento vinculadas)*\n\n---\n\n`;
    }

    md += `## 4. Skills (Skills)\n\n`;
    if (skills && skills.length > 0) {
      // The capability index is what makes the granular fetch usable: without it the agent knows a
      // skill exists but not that it can ask for one operation of it. One line per capability is a
      // cheap price for turning an all-or-nothing pull into a targeted one.
      const capabilityIndex = await this.skillsService.listCapabilitiesByBundleIds(
        skills.map((sk: any) => sk.id || sk._id?.toString()).filter(Boolean),
        orgId
      );

      for (const sk of skills) {
        const skillId = sk.id || sk._id?.toString() || '';
        md += `### Skill: ${sk.name || 'Sin título'}\n`;
        if (sk.description) {
          md += `> Descripción: ${sk.description}\n\n`;
        }
        md += `- ID: \`${skillId}\`\n`;
        if (sk.slug) md += `- Slug: \`${sk.slug}\`\n`;
        if (sk.relPath || sk.sourceUrl) md += `- Ruta/URL: ${sk.relPath || sk.sourceUrl}\n`;

        const capabilities = capabilityIndex.get(skillId) || [];
        if (capabilities.length > 0) {
          md += `- Capacidades:\n`;
          for (const capability of capabilities) {
            const triggers = capability.triggers?.length ? ` _(${capability.triggers.join(', ')})_` : '';
            md += `  - \`${capability.slug}\` — ${capability.name || capability.slug}${triggers}\n`;
          }
        }
        md += `\n`;

        if (level === 'full') md += sk.content ? `${sk.content}\n\n` : `*(Contenido vacío)*\n\n`;
        else if (capabilities.length > 0) {
          md += `> Pedí solo lo que necesites con \`getSkill('<slug de la capacidad>')\`, o la skill completa con \`getSkill('${sk.slug || skillId}')\`.\n\n`;
        } else md += `> Contenido disponible bajo demanda con \`getSkill('${sk.slug || skillId}')\`.\n\n`;
        md += `---\n\n`;
      }
    } else {
      md += `*(No hay skills vinculadas)*\n\n---\n\n`;
    }

    md += `## 5. Exploración (Exploration)\n\n`;
    if (explorations && explorations.length > 0) {
      for (const exp of explorations) {
        md += `### Exploración: ${exp.name || 'Sin título'}\n`;
        if (exp.description) {
          md += `> Descripción: ${exp.description}\n\n`;
        }
        md += `- ID: \`${exp.id || exp._id?.toString() || ''}\`\n`;
        if (exp.sourceUrl) md += `- Ruta/URL: ${exp.sourceUrl}\n`;
        md += `\n`;
        if (level === 'full') md += exp.content ? `${exp.content}\n\n` : `*(Contenido vacío)*\n\n`;
        else md += `> Contenido disponible bajo demanda con \`getProfileSource\`.\n\n`;
        md += `---\n\n`;
      }
    } else {
      md += `*(No hay exploraciones vinculadas)*\n\n---\n\n`;
    }

    md += `## 6. Tareas (Task)\n\n`;
    const unsortedTasks = level === 'basic' ? [] : level === 'medium' ? (tasks || []).filter((task: any) => task.status !== 'done') : tasks || [];
    // Most urgent first, so a truncated context window still carries what matters.
    const visibleTasks = [...unsortedTasks].sort((a: any, b: any) => (b.priority ?? DEFAULT_TASK_PRIORITY) - (a.priority ?? DEFAULT_TASK_PRIORITY));
    if (visibleTasks.length > 0) {
      for (const task of visibleTasks) {
        const statusBox = `[${TASK_STATUS_MARKS[task.status] ?? ' '}]`;
        const priority = task.priority ?? DEFAULT_TASK_PRIORITY;
        md += `- ${statusBox} **${task.name || 'Tarea sin título'}** (ID: \`${task.id || task._id?.toString() || ''}\`, Status: \`${task.status || 'pending'}\`, Prioridad: \`P${priority} ${TASK_PRIORITY_LABELS[priority] ?? ''}\`)\n`;
        if (task.description) {
          md += `  *Descripción:* ${task.description}\n`;
        }
        if (level === 'full' && task.content) {
          md += `\n  \`\`\`markdown\n${task.content
            .split('\n')
            .map((line: string) => `  ${line}`)
            .join('\n')}\n  \`\`\`\n`;
        }
        md += `\n`;
      }
    } else {
      md += level === 'basic' ? `*(Omitidas en nivel BASIC; disponibles desde el perfil.)*\n\n` : `*(No hay tareas pendientes vinculadas)*\n\n`;
    }

    md += `## 7. Memorias - Notas de Sesión y Foco Actual (Memories)\n\n`;
    if (level !== 'basic' && memories && memories.length > 0) {
      for (const mem of memories) {
        md += `### Memoria: ${mem.name || 'Sin título'}\n`;
        if (mem.description) {
          md += `> Descripción: ${mem.description}\n\n`;
        }
        md += `- ID: \`${mem.id || mem._id?.toString() || ''}\`\n\n`;
        if (level === 'full') md += mem.content ? `${mem.content}\n\n` : `*(Contenido vacío)*\n\n`;
        else md += `> Contenido disponible bajo demanda con \`getProfileSource\`.\n\n`;
        md += `---\n\n`;
      }
    } else {
      md += level === 'basic' ? `*(Omitidas en nivel BASIC.)*\n\n` : `*(No hay memorias vinculadas)*\n\n`;
    }

    md += `## 8. Informe Directo (Live Briefing)\n\n`;
    md += profile.liveBriefing ? `${profile.liveBriefing}\n\n` : `*(Sin briefing activo — el propietario no ha dejado instrucciones en este período)*\n\n`;

    return md.trim() + '\n';
  }

  /**
   * Loads one linked resource. Kept for the `getProfileSource` tool of the built-in harness,
   * which expects a flat object and an exception when the id is not reachable.
   */
  async getLinkedContextResource(profileId: string, sourceId: string, orgId?: string): Promise<{ id: string; name?: string; description?: string; sourceUrl?: string; content?: string }> {
    const [resource] = await this.getLinkedContextResources(profileId, [{ id: sourceId }], orgId);
    if (!resource || resource.error === 'not-linked') throw new Error(`Source ${sourceId} is not linked to profile ${profileId}`);
    if (resource.error === 'not-found') throw new Error(`Source ${sourceId} not found`);
    return {
      id: resource.id,
      name: resource.name,
      description: resource.description,
      sourceUrl: resource.sourceUrl,
      content: resource.content,
    };
  }

  /**
   * Resolves several profile-linked resources at once, for the `@mention` attachment flow.
   *
   * Two properties this method owes its callers:
   * 1. **The kind is derived from the profile, not from the request.** The caller's `kind` is a UI
   *    hint; a client cannot relabel a task as a source to make us read a different collection.
   * 2. **A bad ref is flagged, not thrown.** One unreachable id must not kill a whole chat turn,
   *    so unresolved refs come back with `error` and the caller decides what to say about them.
   *
   * Cost is two queries no matter how many refs arrive: one on `sources`, one on `agent_tasks`.
   * The returned array preserves the caller's order, deduplicated.
   */
  async getLinkedContextResources(profileId: string, refs: Array<{ id: string }>, orgId?: string): Promise<ILinkedContextResource[]> {
    const requestedIds = Array.from(new Set((refs || []).map(ref => ref?.id).filter(Boolean)));
    if (requestedIds.length === 0) return [];

    const profile = await this.genericModel.findOne(this.buildProfileIdentityQuery(profileId, orgId)).lean().exec();
    if (!profile) throw new Error(`AgenticProfile with ID ${profileId} not found`);

    const kindById = this.buildLinkedKindMap(profile);
    const sourceLikeIds: string[] = [];
    const skillIds: string[] = [];
    const taskIds: string[] = [];
    for (const id of requestedIds) {
      const kind = kindById.get(id);
      if (!kind) continue;
      if (kind === 'task') taskIds.push(id);
      else if (kind === 'skill') skillIds.push(id);
      else sourceLikeIds.push(id);
    }

    const [sources, skills, tasks] = await Promise.all([
      sourceLikeIds.length > 0 ? this.sourcesService.findManyByIds(sourceLikeIds, orgId) : Promise.resolve([]),
      skillIds.length > 0 ? this.skillsService.findManyByIds(skillIds, orgId) : Promise.resolve([]),
      taskIds.length > 0
        ? this.agentTasksService.executeOperation({ action: 'find', query: { id: { $in: taskIds }, ...(orgId ? { orgId } : {}) } })
        : Promise.resolve([]),
    ]);

    const sourceById = new Map<string, any>((sources || []).map((doc: any) => [doc.id, doc]));
    const taskById = new Map<string, any>((Array.isArray(tasks) ? tasks : []).map((doc: any) => [doc.id, doc]));
    // Skills answer to their folded aliases too, so a mention carrying a pre-migration id resolves.
    const skillById = new Map<string, any>();
    for (const doc of (skills || []) as any[]) {
      skillById.set(doc.id, doc);
      for (const alias of doc.aliasIds || []) skillById.set(alias, doc);
    }

    return requestedIds.map((id): ILinkedContextResource => {
      const kind = kindById.get(id);
      if (!kind) return { id, error: 'not-linked' };

      const doc = kind === 'task' ? taskById.get(id) : kind === 'skill' ? skillById.get(id) : sourceById.get(id);
      if (!doc) return { id, kind, error: 'not-found' };

      return {
        id,
        kind,
        name: doc.name,
        description: doc.description,
        sourceUrl: doc.relPath || doc.sourceUrl,
        content: doc.content,
        ...(kind === 'task' ? { status: doc.status } : {}),
      };
    });
  }

  private buildProfileIdentityQuery(profileId: string, orgId?: string): any {
    const identityClauses: any[] = [{ id: profileId }];
    if (mongoose.Types.ObjectId.isValid(profileId)) identityClauses.push({ _id: new mongoose.Types.ObjectId(profileId) });
    return { $or: identityClauses, ...(orgId ? { orgId } : {}) };
  }

  /**
   * Maps every id the profile links to its category. `enabled === false` links are left out on
   * purpose: `composeFullContext` already hides them from the context index, so offering them as
   * an attachment would contradict what the agent is told it has.
   */
  private buildLinkedKindMap(profile: any): Map<string, AgenticLinkedResourceKind> {
    const map = new Map<string, AgenticLinkedResourceKind>();
    this.eachLinkedRef(profile, (item, kind) => {
      if (map.has(item.id)) return;
      map.set(item.id, kind);
    });
    return map;
  }

  /**
   * Single traversal of the five linked arrays, shared by everything that needs to know what a
   * profile links and under which category.
   *
   * There is exactly one copy of this walk on purpose: the kind of an attachment is derived from
   * *which array holds it*, so a second traversal that drifted — a missing `enabled` check, a
   * different order — would let the catalog offer something the resolver then refuses.
   */
  private eachLinkedRef(profile: any, visit: (item: any, kind: AgenticLinkedResourceKind) => void): void {
    const walk = (items: any[] | undefined, kind: AgenticLinkedResourceKind, respectEnabled = false) => {
      for (const item of items || []) {
        if (!item?.id) continue;
        if (respectEnabled && item.enabled === false) continue;
        visit(item, kind);
      }
    };
    walk(profile?.sources, 'knowledge');
    walk(profile?.skills, 'skill', true);
    walk(profile?.explorations, 'exploration', true);
    walk(profile?.memories, 'memory', true);
    walk(profile?.tasks, 'task');
  }

  /**
   * The profile's own resources as mention-menu rows, without touching any other collection.
   *
   * The refs embedded in the profile already carry `name`/`description`, so this costs one document
   * read — the reason the profile half of the catalog can stay instant while the organization half
   * goes to the server.
   */
  async listLinkedMentionOptions(
    profileId: string,
    orgId?: string,
  ): Promise<Array<{ id: string; kind: AgenticLinkedResourceKind; name: string; description?: string; sourceUrl?: string; status?: string }>> {
    const profile = await this.genericModel.findOne(this.buildProfileIdentityQuery(profileId, orgId)).lean().exec();
    if (!profile) return [];

    const options: Array<{ id: string; kind: AgenticLinkedResourceKind; name: string; description?: string; sourceUrl?: string; status?: string }> = [];
    const seen = new Set<string>();
    this.eachLinkedRef(profile, (item, kind) => {
      if (seen.has(item.id)) return;
      seen.add(item.id);
      options.push({
        id: item.id,
        kind,
        name: item.name || item.id,
        description: item.description || undefined,
        sourceUrl: item.url || item.relPath || undefined,
        ...(kind === 'task' && item.status ? { status: item.status } : {}),
      });
    });
    return options;
  }

  /**
   * Profiles of one organization as mention-menu rows.
   *
   * `orgId` is mandatory for the same reason as in `SourcesService.searchForMentions`: an empty one
   * would list every tenant's agents. Disabled profiles are skipped — an agent that cannot run is
   * not someone to hand work to.
   */
  async searchForMentions(orgId: string, query: string, limit = 12): Promise<any[]> {
    if (!orgId) return [];
    const filter: Record<string, any> = { orgId, enabled: { $ne: false } };
    const trimmed = (query ?? '').trim();
    if (trimmed) {
      const rx = new RegExp(trimmed.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
      filter.$or = [{ name: rx }, { title: rx }, { description: rx }, { domain: rx }];
    }

    return this.genericModel
      .find(filter, { id: 1, name: 1, title: 1, description: 1, domain: 1 })
      .sort({ name: 1 })
      .limit(Math.max(1, Math.min(limit, 50)))
      .lean()
      .exec();
  }

  /**
   * Loads profiles for the `@agent` mention, scoped to the organization.
   *
   * Projects what a **capability card** needs and nothing else. In particular it does not read the
   * linked agent card: another agent's `characterCard.instructions` are that agent's system prompt,
   * and injecting them into this agent's turn would put foreign directives inside a block we
   * explicitly frame as data. What a colleague needs to know is *what the other one does*, not how
   * it was told to behave.
   */
  async findManyForMentionCards(ids: string[], orgId: string): Promise<any[]> {
    if (!ids?.length || !orgId) return [];
    const objectIds = ids.filter(id => mongoose.Types.ObjectId.isValid(id)).map(id => new mongoose.Types.ObjectId(id));
    return this.genericModel
      .find(
        { orgId, $or: [{ id: { $in: ids } }, ...(objectIds.length ? [{ _id: { $in: objectIds } }] : [])] },
        { id: 1, name: 1, title: 1, description: 1, domain: 1, skills: 1, tasks: 1, workspaceId: 1, heartbeat: 1, acpConfig: 1 },
      )
      .lean()
      .exec();
  }
}
