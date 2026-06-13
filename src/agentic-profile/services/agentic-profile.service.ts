import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import mongoose, { Model } from 'mongoose';
import { EntityCommunicationService, MongoService } from '@dataclouder/nest-mongo';
import { AgenticProfileDocument, AgenticProfileEntity } from '../schemas/agentic-profile.schema';
import { AgentCardService } from '@dataclouder/nest-agent-cards';
import { AgentSourcesService } from '../../agent-tasks/services/agent-sources.service';
import { AgentTasksService } from '../../agent-tasks/services/agent-tasks.service';
import * as fs from 'fs';

@Injectable()
export class AgenticProfileService extends EntityCommunicationService<AgenticProfileDocument> {
  constructor(
    @InjectModel(AgenticProfileEntity.name)
    agenticProfileModel: Model<AgenticProfileDocument>,
    mongoService: MongoService,
    private readonly agentCardService: AgentCardService,
    private readonly agentSourcesService: AgentSourcesService,
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
          { _id: new mongoose.Types.ObjectId(agenticProfileId) }
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

    // Helper function to read local file contents
    const getLocalFileContent = (urlStr: string): string => {
      try {
        if (urlStr.startsWith('file://')) {
          let filePath = urlStr.replace('file://', '');
          // On Windows/Mac, handle format differences
          if (process.platform === 'win32' && filePath.startsWith('/')) {
            filePath = filePath.slice(1);
          }
          const decodedPath = decodeURIComponent(filePath);
          if (fs.existsSync(decodedPath)) {
            return fs.readFileSync(decodedPath, 'utf8');
          }
        }
      } catch (err) {
        console.error(`Error reading local file ${urlStr}:`, err);
      }
      return '';
    };

    // 3. Sync Knowledge Sources (Section 3)
    const sec3 = sections.find((s: any) => s.number === 3);
    const resolvedSources = [];
    if (sec3 && sec3.links) {
      for (const link of sec3.links) {
        // Query agent_sources by sourceUrl and orgId
        const query = { sourceUrl: link.url, orgId };
        let sourceEntity = await this.agentSourcesService.executeOperation({
          action: 'findOne',
          query,
        });

        const fileContent = getLocalFileContent(link.url);
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
          await this.agentSourcesService.executeOperation({
            action: 'updateOne',
            query: { id: sourceEntity.id },
            payload: { $set: sourceData },
          });
          sourceEntity = await this.agentSourcesService.executeOperation({
            action: 'findOne',
            query: { id: sourceEntity.id },
          });
        } else {
          sourceData.auditable = { createdBy: userEmail, updatedBy: userEmail };
          sourceEntity = await this.agentSourcesService.executeOperation({
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
        let skillEntity = await this.agentSourcesService.executeOperation({
          action: 'findOne',
          query,
        });

        const fileContent = getLocalFileContent(link.url);
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
          await this.agentSourcesService.executeOperation({
            action: 'updateOne',
            query: { id: skillEntity.id },
            payload: { $set: skillData },
          });
          skillEntity = await this.agentSourcesService.executeOperation({
            action: 'findOne',
            query: { id: skillEntity.id },
          });
        } else {
          skillData.auditable = { createdBy: userEmail, updatedBy: userEmail };
          skillEntity = await this.agentSourcesService.executeOperation({
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

    // 5. Sync Tasks (Section 5)
    const sec5 = sections.find((s: any) => s.number === 5);
    const resolvedTasks = [];
    const taskWriteBacks = []; // Return list of tasks to update local frontmatter

    if (sec5 && sec5.links) {
      for (const link of sec5.links) {
        let taskEntity = null;
        if (link.taskId) {
          taskEntity = await this.agentTasksService.findOne(link.taskId);
        }

        const taskStatus = link.status || 'pending';

        const taskData: any = {
          orgId,
          name: link.label,
          description: link.description,
          status: taskStatus,
          assignedType: 'agent',
          assignedTo: {
            id: agentCardId,
            name: agentName,
            description: agentTitle,
          },
        };

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
        });
      }
    }
    profile.tasks = resolvedTasks;

    // 6. Sync Memories (Section 6)
    const sec6 = sections.find((s: any) => s.number === 6);
    const resolvedMemories = [];
    if (sec6 && sec6.links) {
      for (const link of sec6.links) {
        const query = { sourceUrl: link.url, orgId };
        let memoryEntity = await this.agentSourcesService.executeOperation({
          action: 'findOne',
          query,
        });

        const fileContent = getLocalFileContent(link.url);
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
          await this.agentSourcesService.executeOperation({
            action: 'updateOne',
            query: { id: memoryEntity.id },
            payload: { $set: memoryData },
          });
          memoryEntity = await this.agentSourcesService.executeOperation({
            action: 'findOne',
            query: { id: memoryEntity.id },
          });
        } else {
          memoryData.auditable = { createdBy: userEmail, updatedBy: userEmail };
          memoryEntity = await this.agentSourcesService.executeOperation({
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

    // Save profile updates
    await profile.save();

    return {
      success: true,
      profileId: profile.id || profile._id?.toString(),
      agentCardId,
      tasks: taskWriteBacks,
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

    // Query Source, Skill, Task, and Memory entities
    const [sources, skills, tasks, memories] = await Promise.all([
      sourceIds.length > 0
        ? this.agentSourcesService.findManyByIds(sourceIds)
        : Promise.resolve([]),
      skillIds.length > 0
        ? this.agentSourcesService.findManyByIds(skillIds)
        : Promise.resolve([]),
      taskIds.length > 0
        ? this.agentTasksService.executeOperation({
            action: 'find',
            query: { id: { $in: taskIds } }
          })
        : Promise.resolve([]),
      memoryIds.length > 0
        ? this.agentSourcesService.findManyByIds(memoryIds)
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

    md += `## 5. Tareas (Task)\n\n`;
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

    md += `## 6. Memorias - Notas de Sesión y Foco Actual (Memories)\n\n`;
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

    return md.trim() + '\n';
  }
}

