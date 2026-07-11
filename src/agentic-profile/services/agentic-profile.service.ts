import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import mongoose, { Model } from 'mongoose';
import { EntityCommunicationService, MongoService } from '@dataclouder/nest-mongo';
import { AgenticProfileDocument, AgenticProfileEntity } from '../schemas/agentic-profile.schema';
import { AgentCardService } from '@dataclouder/nest-agent-cards';
import { SourcesService } from '../../agent-tasks/services/sources.service';
import { AgentTasksService } from '../../agent-tasks/services/agent-tasks.service';
import { mergeMarkdownSubtasks, parseSubtasksFromMarkdown } from '../../agent-tasks/services/subtask-markdown.util';

@Injectable()
export class AgenticProfileService extends EntityCommunicationService<AgenticProfileDocument> {
  constructor(
    @InjectModel(AgenticProfileEntity.name)
    agenticProfileModel: Model<AgenticProfileDocument>,
    mongoService: MongoService,
    private readonly agentCardService: AgentCardService,
    private readonly sourcesService: SourcesService,
    private readonly agentTasksService: AgentTasksService,
  ) {
    super(agenticProfileModel, mongoService);
  }

  async syncFromMarkdown(payload: any, orgId: string, userEmail: string): Promise<any> {
    const { agentCardId, agenticProfileId, agentName, agentTitle, agentDescription, agentDomain, sections } = payload;

    if (!agentCardId) {
      throw new Error('agentCardId is required in the frontmatter YAML');
    }

    // 1. Find and update AgentCard identity & instructions (Section 1)
    const agentCard = await this.agentCardService.findById(agentCardId);
    if (!agentCard) {
      throw new Error(`AgentCard with ID ${agentCardId} not found in database`);
    }

    // Find section 1 content
    const sec1 = sections.find((s: any) => s.number === 1);
    const instructions = sec1 ? sec1.content : '';

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

    // 3. Sync Knowledge Sources (Section 3)
    const sec3 = sections.find((s: any) => s.number === 3);
    const resolvedSources = [];
    if (sec3 && sec3.links) {
      for (const link of sec3.links) {
        // Query agent_sources by sourceUrl and orgId
        const query = { sourceUrl: link.url, orgId };
        let sourceEntity = await this.sourcesService.executeOperation({
          action: 'findOne',
          query,
        });

        const fileContent = link.content;
        const sourceData: any = {
          orgId,
          name: link.label,
          description: link.description,
          sourceUrl: link.url,
          type: 'document',
          content: fileContent || link.description,
          status: 'active',
        };

        if (sourceEntity) {
          await this.sourcesService.executeOperation({
            action: 'updateOne',
            query: { id: sourceEntity.id },
            payload: { $set: sourceData },
          });
          sourceEntity = await this.sourcesService.executeOperation({
            action: 'findOne',
            query: { id: sourceEntity.id },
          });
        } else {
          sourceData.auditable = { createdBy: userEmail, updatedBy: userEmail };
          sourceEntity = await this.sourcesService.executeOperation({
            action: 'create',
            payload: sourceData,
          });
        }

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
        const query = { sourceUrl: link.url, orgId };
        let skillEntity = await this.sourcesService.executeOperation({
          action: 'findOne',
          query,
        });

        const fileContent = link.content;
        const skillData: any = {
          orgId,
          name: link.label,
          description: link.description,
          sourceUrl: link.url,
          type: 'document',
          content: fileContent || link.description,
          tag: 'rule', // skills act as rules
          status: 'active',
        };

        if (skillEntity) {
          await this.sourcesService.executeOperation({
            action: 'updateOne',
            query: { id: skillEntity.id },
            payload: { $set: skillData },
          });
          skillEntity = await this.sourcesService.executeOperation({
            action: 'findOne',
            query: { id: skillEntity.id },
          });
        } else {
          skillData.auditable = { createdBy: userEmail, updatedBy: userEmail };
          skillEntity = await this.sourcesService.executeOperation({
            action: 'create',
            payload: skillData,
          });
        }

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
        const query = { sourceUrl: link.url, orgId };
        let explorationEntity = await this.sourcesService.executeOperation({
          action: 'findOne',
          query,
        });

        const fileContent = link.content;
        const explorationData: any = {
          orgId,
          name: link.label,
          description: link.description,
          sourceUrl: link.url,
          type: 'document',
          content: fileContent || link.description,
          tag: 'exploration', // explorations act as exploration sources
          status: 'active',
        };

        if (explorationEntity) {
          await this.sourcesService.executeOperation({
            action: 'updateOne',
            query: { id: explorationEntity.id },
            payload: { $set: explorationData },
          });
          explorationEntity = await this.sourcesService.executeOperation({
            action: 'findOne',
            query: { id: explorationEntity.id },
          });
        } else {
          explorationData.auditable = { createdBy: userEmail, updatedBy: userEmail };
          explorationEntity = await this.sourcesService.executeOperation({
            action: 'create',
            payload: explorationData,
          });
        }

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

        const fileContent = link.content;
        const taskData: any = {
          orgId,
          name: link.label,
          description: link.description,
          content: fileContent || link.description,
          sourceUrl: link.url,
          status: taskStatus,
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
        } else {
          taskData.auditable = { createdBy: userEmail, updatedBy: userEmail };
          taskEntity = await this.agentTasksService.executeOperation({
            action: 'create',
            payload: taskData,
          });
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
        const query = { sourceUrl: link.url, orgId };
        let memoryEntity = await this.sourcesService.executeOperation({
          action: 'findOne',
          query,
        });

        const fileContent = link.content;
        const memoryData: any = {
          orgId,
          name: link.label,
          description: link.description,
          sourceUrl: link.url,
          type: 'document',
          content: fileContent || link.description,
          tag: 'memory', // memories act as memory sources
          status: 'active',
        };

        if (memoryEntity) {
          await this.sourcesService.executeOperation({
            action: 'updateOne',
            query: { id: memoryEntity.id },
            payload: { $set: memoryData },
          });
          memoryEntity = await this.sourcesService.executeOperation({
            action: 'findOne',
            query: { id: memoryEntity.id },
          });
        } else {
          memoryData.auditable = { createdBy: userEmail, updatedBy: userEmail };
          memoryEntity = await this.sourcesService.executeOperation({
            action: 'create',
            payload: memoryData,
          });
        }

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
    };
  }

  async composeFullContext(profileId: string, orgId?: string): Promise<string> {
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
    const skillIds = (profile.skills || []).map((s: any) => s.id);
    const taskIds = (profile.tasks || []).map((t: any) => t.id);
    const memoryIds = (profile.memories || []).map((m: any) => m.id);
    const explorationIds = (profile.explorations || []).map((e: any) => e.id);

    // Query Source, Skill, Task, Memory, and Exploration entities
    const [sources, skills, tasks, memories, explorations] = await Promise.all([
      sourceIds.length > 0
        ? this.sourcesService.findManyByIds(sourceIds)
        : Promise.resolve([]),
      skillIds.length > 0
        ? this.sourcesService.findManyByIds(skillIds)
        : Promise.resolve([]),
      taskIds.length > 0
        ? this.agentTasksService.executeOperation({
            action: 'find',
            query: { id: { $in: taskIds } }
          })
        : Promise.resolve([]),
      memoryIds.length > 0
        ? this.sourcesService.findManyByIds(memoryIds)
        : Promise.resolve([]),
      explorationIds.length > 0
        ? this.sourcesService.findManyByIds(explorationIds)
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
        md += src.content ? `${src.content}\n\n` : `*(Contenido vacío)*\n\n`;
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
        md += sk.content ? `${sk.content}\n\n` : `*(Contenido vacío)*\n\n`;
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
        md += exp.content ? `${exp.content}\n\n` : `*(Contenido vacío)*\n\n`;
        md += `---\n\n`;
      }
    } else {
      md += `*(No hay exploraciones vinculadas)*\n\n---\n\n`;
    }

    md += `## 6. Tareas (Task)\n\n`;
    if (tasks && tasks.length > 0) {
      for (const task of tasks) {
        const statusBox = task.status === 'done' ? '[x]' : task.status === 'in_progress' ? '[/]' : '[ ]';
        md += `- ${statusBox} **${task.name || 'Tarea sin título'}** (ID: \`${task.id || task._id?.toString() || ''}\`, Status: \`${task.status || 'pending'}\`)\n`;
        if (task.description) {
          md += `  *Descripción:* ${task.description}\n`;
        }
        if (task.content) {
          md += `\n  \`\`\`markdown\n${task.content.split('\n').map((line: string) => `  ${line}`).join('\n')}\n  \`\`\`\n`;
        }
        md += `\n`;
      }
    } else {
      md += `*(No hay tareas vinculadas)*\n\n`;
    }

    md += `## 7. Memorias - Notas de Sesión y Foco Actual (Memories)\n\n`;
    if (memories && memories.length > 0) {
      for (const mem of memories) {
        md += `### Memoria: ${mem.name || 'Sin título'}\n`;
        if (mem.description) {
          md += `> Descripción: ${mem.description}\n\n`;
        }
        md += mem.content ? `${mem.content}\n\n` : `*(Contenido vacío)*\n\n`;
        md += `---\n\n`;
      }
    } else {
      md += `*(No hay memorias vinculadas)*\n\n`;
    }

    md += `## 8. Informe Directo (Live Briefing)\n\n`;
    md += profile.liveBriefing ? `${profile.liveBriefing}\n\n` : `*(Sin briefing activo — el propietario no ha dejado instrucciones en este período)*\n\n`;

    return md.trim() + '\n';
  }
}

