import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import mongoose, { Model } from 'mongoose';
import { EntityCommunicationService, MongoService } from '@dataclouder/nest-mongo';
import { AgenticProfileDocument, AgenticProfileEntity } from '../schemas/agentic-profile.schema';
import { AgentCardService } from '@dataclouder/nest-agent-cards';
import { SourcesService } from '../../agent-tasks/services/sources.service';
import { AgentTasksService } from '../../agent-tasks/services/agent-tasks.service';
import { mergeMarkdownSubtasks, parseSubtasksFromMarkdown } from '../../agent-tasks/services/subtask-markdown.util';
import { AgenticContextLevel } from '../models/agentic-profile.models';
import { buildFingerprint, hashContent } from './sync-hash.util';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { WIKI_PROFILE_CHANGED } from '../../wiki-sync/wiki-sync.events';

interface SyncStats {
  created: number;
  updated: number;
  skipped: number;
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
  ) {
    super(agenticProfileModel, mongoService);
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
    workspaceId?: string,
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
    if (
      entity &&
      entity.contentHash === contentHash &&
      entity.name === link.label &&
      entity.description === link.description &&
      (!fingerprint || entity.fingerprint === fingerprint)
    ) {
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
      profile = await this.genericModel.findOne({
        $or: [
          { id: agenticProfileId },
          { _id: new mongoose.Types.ObjectId(agenticProfileId as string) }
        ],
        orgId
      }).exec();
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

    // 4. Sync Skills (Section 4)
    const sec4 = sections.find((s: any) => s.number === 4);
    const resolvedSkills = [];
    if (sec4 && sec4.links) {
      for (const link of sec4.links) {
        // skills act as rules
        const skillEntity = await this.upsertSourceFromLink(link, 'skill', 'rule', orgId, userEmail, stats, workspaceId);

        resolvedSkills.push({
          id: skillEntity.id || skillEntity._id?.toString(),
          name: skillEntity.name,
          description: skillEntity.description,
          enabled: true,
        });
      }
    }
    profile.skills = resolvedSkills;

    // 4b. Prepare skill write-backs for local frontmatter updates
    const skillWriteBacks = [];
    if (sec4 && sec4.links) {
      for (let i = 0; i < sec4.links.length; i++) {
        const link = sec4.links[i];
        const skill = resolvedSkills[i];
        if (skill && skill.id) {
          skillWriteBacks.push({
            url: link.url,
            label: link.label,
            sourceId: skill.id,
            orgId,
          });
        }
      }
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
        const hasContent = link.content !== undefined && link.content !== null;
        const taskFingerprint = workspaceId && link.relPath ? buildFingerprint(workspaceId, link.relPath) : undefined;
        const taskContractFields: any = taskFingerprint ? { fingerprint: taskFingerprint, workspaceId, relPath: link.relPath } : {};

        if (taskEntity && !hasContent) {
          // Delta sync: content unchanged per manifest. Status still flows from the local
          // checkbox/frontmatter, so apply it alone when it differs.
          const fingerprintChanged = taskFingerprint && taskEntity.fingerprint !== taskFingerprint;
          if (taskStatus !== taskEntity.status || fingerprintChanged) {
            await this.agentTasksService.executeOperation({
              action: 'updateOne',
              query: { id: link.taskId },
              payload: { $set: { status: taskStatus, ...taskContractFields } },
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
        });

        // Add to write-back list
        taskWriteBacks.push({
          url: link.url,
          label: link.label,
          taskId: resolvedId,
          orgId,
          status: taskEntity.status,
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
      $or: [
        { id: profileId },
        { _id: mongoose.Types.ObjectId.isValid(profileId) ? new mongoose.Types.ObjectId(profileId) : null }
      ].filter(q => q._id !== null)
    };
    if (orgId) {
      query.orgId = orgId;
    }
    const profile = await this.genericModel.findOne(query).exec();
    if (!profile) {
      throw new Error(`AgenticProfile with ID ${profileId} not found`);
    }

    const sourceIds = [
      ...(profile.sources || []),
      ...(profile.skills || []),
      ...(profile.explorations || []),
      ...(profile.memories || []),
    ].map((s: any) => s.id).filter(Boolean);
    const taskIds = (profile.tasks || []).map((t: any) => t.id).filter(Boolean);

    const [sources, tasks] = await Promise.all([
      sourceIds.length > 0 ? this.sourcesService.findManyByIds(sourceIds) : Promise.resolve([]),
      taskIds.length > 0
        ? this.agentTasksService.executeOperation({ action: 'find', query: { id: { $in: taskIds }, orgId: profile.orgId } })
        : Promise.resolve([]),
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
        contentHash: t.contentHash || null,
      })),
    };
  }

  async composeFullContext(profileId: string, orgId?: string, levelOverride?: AgenticContextLevel): Promise<string> {
    const query: any = {
      $or: [
        { id: profileId },
        { _id: mongoose.Types.ObjectId.isValid(profileId) ? new mongoose.Types.ObjectId(profileId) : null }
      ].filter(q => q._id !== null)
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
      sourceIds.length > 0
        ? this.sourcesService.findManyByIds(sourceIds, orgId)
        : Promise.resolve([]),
      skillIds.length > 0
        ? this.sourcesService.findManyByIds(skillIds, orgId)
        : Promise.resolve([]),
      taskIds.length > 0
        ? this.agentTasksService.executeOperation({
          action: 'find',
            query: { id: { $in: taskIds }, ...(orgId ? { orgId } : {}) }
          })
        : Promise.resolve([]),
      memoryIds.length > 0
        ? this.sourcesService.findManyByIds(memoryIds, orgId)
        : Promise.resolve([]),
      explorationIds.length > 0
        ? this.sourcesService.findManyByIds(explorationIds, orgId)
        : Promise.resolve([])
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
      for (const sk of skills) {
        md += `### Skill: ${sk.name || 'Sin título'}\n`;
        if (sk.description) {
          md += `> Descripción: ${sk.description}\n\n`;
        }
        md += `- ID: \`${sk.id || sk._id?.toString() || ''}\`\n`;
        if (sk.sourceUrl) md += `- Ruta/URL: ${sk.sourceUrl}\n`;
        md += `\n`;
        if (level === 'full') md += sk.content ? `${sk.content}\n\n` : `*(Contenido vacío)*\n\n`;
        else md += `> Contenido disponible bajo demanda con \`getProfileSource\`.\n\n`;
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
    const visibleTasks = level === 'basic' ? [] : level === 'medium'
      ? (tasks || []).filter((task: any) => task.status !== 'done')
      : (tasks || []);
    if (visibleTasks.length > 0) {
      for (const task of visibleTasks) {
        const statusBox = task.status === 'done' ? '[x]' : task.status === 'in_progress' ? '[/]' : '[ ]';
        md += `- ${statusBox} **${task.name || 'Tarea sin título'}** (ID: \`${task.id || task._id?.toString() || ''}\`, Status: \`${task.status || 'pending'}\`)\n`;
        if (task.description) {
          md += `  *Descripción:* ${task.description}\n`;
        }
        if (level === 'full' && task.content) {
          md += `\n  \`\`\`markdown\n${task.content.split('\n').map((line: string) => `  ${line}`).join('\n')}\n  \`\`\`\n`;
        }
        md += `\n`;
      }
    } else {
      md += level === 'basic'
        ? `*(Omitidas en nivel BASIC; disponibles desde el perfil.)*\n\n`
        : `*(No hay tareas pendientes vinculadas)*\n\n`;
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
      md += level === 'basic'
        ? `*(Omitidas en nivel BASIC.)*\n\n`
        : `*(No hay memorias vinculadas)*\n\n`;
    }

    md += `## 8. Informe Directo (Live Briefing)\n\n`;
    md += profile.liveBriefing ? `${profile.liveBriefing}\n\n` : `*(Sin briefing activo — el propietario no ha dejado instrucciones en este período)*\n\n`;

    return md.trim() + '\n';
  }

  async getLinkedContextResource(profileId: string, sourceId: string, orgId?: string): Promise<{ id: string; name?: string; description?: string; sourceUrl?: string; content?: string }> {
    const profileQuery: any = {
      $or: [
        { id: profileId },
        { _id: mongoose.Types.ObjectId.isValid(profileId) ? new mongoose.Types.ObjectId(profileId) : null },
      ].filter(item => item._id !== null),
      ...(orgId ? { orgId } : {}),
    };
    const profile = await this.genericModel.findOne(profileQuery).lean().exec();
    if (!profile) throw new Error(`AgenticProfile with ID ${profileId} not found`);

    const linkedIds = [
      ...(profile.sources || []),
      ...(profile.skills || []),
      ...(profile.memories || []),
      ...(profile.explorations || []),
    ].map((item: any) => item.id);
    if (!linkedIds.includes(sourceId)) throw new Error(`Source ${sourceId} is not linked to profile ${profileId}`);

    const [source] = await this.sourcesService.findManyByIds([sourceId], orgId);
    if (!source) throw new Error(`Source ${sourceId} not found`);
    return {
      id: source.id,
      name: source.name,
      description: source.description,
      sourceUrl: source.sourceUrl,
      content: source.content,
    };
  }
}
