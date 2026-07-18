import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { EventEmitter2 } from '@nestjs/event-emitter';

import { firstValueFrom } from 'rxjs';
import { HttpService } from '@nestjs/axios';
import { CreatePageParameters } from '@notionhq/client/build/src/api-endpoints';
// @dataclouder libs
import { EntityCommunicationService, MongoService } from '@dataclouder/nest-mongo';
// import { NotionService, NotionWritesService, renderPageContentToMarkdown } from 'libs/nest-notion/src';
import { buildInitialConversation, ChatRole, AgentCardService, IAgentCard, ChatMessage } from '@dataclouder/nest-agent-cards';
// local
import { AgentTaskEntity, AgentTaskDocument } from '../schemas/agent-task.schema';
import { AgentTaskType, AssignedType, IAgentTask, IAgentOutcomeJob, ISourceTask, ISubtask, MessageAI, OutputTaks, SubtaskStatus, TaskStatus } from '../models/classes';
import { AgentOutcomeJobService } from './agent-job.service';
import { SourcesService } from './sources.service';
import { ChatLLMRequestAdapter, AiServicesSdkClient, MessageLLM } from '@dataclouder/nest-ai-services-sdk';
import { taskPrompt } from '../prompts/task-prompts';
import { AppException } from '@dataclouder/nest-core';
import { emitWikiChangeForOperation, WIKI_TASK_CHANGED } from '../../wiki-sync/wiki-sync.events';

@Injectable()
export class AgentTasksService extends EntityCommunicationService<AgentTaskDocument> {
  constructor(
    @InjectModel(AgentTaskEntity.name)
    agentTaskModel: Model<AgentTaskDocument>,
    mongoService: MongoService,
    private conversationAiService: AgentCardService,
    private httpService: HttpService,
    // private notionWritesService: NotionWritesService,
    // private notionService: NotionService,
    private agentJobService: AgentOutcomeJobService,
    private sourcesService: SourcesService,
    private aiServicesClient: AiServicesSdkClient,
    private eventEmitter: EventEmitter2
  ) {
    super(agentTaskModel, mongoService);
  }

  /** Every generic write (UI CRUD, sync, heartbeat tools) flows through here — notify the wiki write-back */
  async executeOperation(operation: any): Promise<any> {
    const result = await super.executeOperation(operation);
    emitWikiChangeForOperation(this.eventEmitter, WIKI_TASK_CHANGED, operation, result);
    return result;
  }

  /** Sync-contract fields written by the wiki write-back itself — deliberately does NOT emit events */
  async updateSyncContract(id: string, fields: Partial<AgentTaskEntity>): Promise<void> {
    await this.genericModel.updateOne({ _id: id }, { $set: fields }).exec();
  }

  private emitChanged(task: any): void {
    const id = task?.id || task?._id?.toString();
    if (id) this.eventEmitter.emit(WIKI_TASK_CHANGED, { id });
  }

  async save(createAgentTaskDto: IAgentTask) {
    const id = createAgentTaskDto.id || createAgentTaskDto._id;
    if (createAgentTaskDto?.agentCard?.id) {
      const agentCard = await this.conversationAiService.getConversationById(createAgentTaskDto.agentCard.id);
      const { assets, description } = agentCard;
      const name = agentCard?.characterCard?.data?.name || agentCard?.name || '';
      createAgentTaskDto.agentCard = { id: createAgentTaskDto.agentCard.id, assets, name, description };
    }
    if (id) {
      const updated = await this.update(id, createAgentTaskDto);
      this.emitChanged(updated || { id });
      return updated;
    } else {
      delete createAgentTaskDto._id;
      delete createAgentTaskDto.id;
      const createdTask = new this.genericModel(createAgentTaskDto);
      const saved = await createdTask.save();
      this.emitChanged(saved);
      return saved;
    }
  }

  /** Replaces the full subtask list (add/edit/delete/reorder) and recalculates the parent status */
  async setSubtasks(taskId: string, subtasks: ISubtask[]): Promise<AgentTaskDocument> {
    const task = await this.genericModel.findById(taskId);
    if (!task) {
      throw new AppException({ error_message: 'Task not found', explanation: `No existe la tarea ${taskId}` });
    }
    task.subtasks = subtasks || [];
    this.applyParentStatusRule(task);
    task.markModified('subtasks');
    const saved = await task.save();
    this.emitChanged(saved);
    return saved;
  }

  /** Updates a single subtask status; completes the parent when all are done, reopens it otherwise */
  async updateSubtaskStatus(taskId: string, subtaskId: string, status: SubtaskStatus, completedBy?: string): Promise<AgentTaskDocument> {
    const task = await this.genericModel.findById(taskId);
    if (!task) {
      throw new AppException({ error_message: 'Task not found', explanation: `No existe la tarea ${taskId}` });
    }
    const subtask = (task.subtasks || []).find(st => st.id === subtaskId);
    if (!subtask) {
      throw new AppException({ error_message: 'Subtask not found', explanation: `No existe la subtarea ${subtaskId} en la tarea ${taskId}` });
    }
    subtask.status = status;
    if (status === SubtaskStatus.DONE) {
      subtask.completedAt = new Date();
      if (completedBy) subtask.completedBy = completedBy;
    } else {
      delete subtask.completedAt;
      delete subtask.completedBy;
    }
    this.applyParentStatusRule(task);
    task.markModified('subtasks');
    const saved = await task.save();
    this.emitChanged(saved);
    return saved;
  }

  /** All subtasks done → parent done; any pending on a done parent → back to in_progress */
  private applyParentStatusRule(task: AgentTaskDocument): void {
    const subtasks = task.subtasks || [];
    if (!subtasks.length) return;
    const allDone = subtasks.every(st => st.status === SubtaskStatus.DONE);
    if (allDone) {
      task.status = TaskStatus.DONE;
    } else if (task.status === TaskStatus.DONE) {
      task.status = TaskStatus.IN_PROGRESS;
    }
  }

  async callPythonAgent(chatMessages: ChatMessage[], task: IAgentTask): Promise<{ content: string; role: string; metadata: any }> {
    const request = {
      messages: chatMessages,
      modelName: task.agentTask?.model?.modelName,
      provider: task.agentTask?.model?.provider,
      type: task.taskType,
      additionalProp1: {},
    };
    const serverUrl = process.env.PYTHON_SERVER_URL;
    const url = `${serverUrl}/api/conversation/agent/chat`;
    console.log('Sending agent request: ', request.provider, request.modelName, request.type);
    try {
      const response = await firstValueFrom(this.httpService.post(url, request));
      console.log('Agent Service response: ', response.data.content.slice(0, 100));
      return response.data;
    } catch (error) {
      console.error('Error calling Python agent: ', error);
      throw new AppException({ error_message: 'Error calling Python web service agent: ' + error.message, explanation: error.response.data });
    }
  }

  // private async getNotionStringFromSources(sources: ISourceTask[]): Promise<string> {
  //   let infoFromSources = '';
  //   if (sources.length > 0) {
  //     for (const source of sources) {
  //       console.log(source);
  //       infoFromSources += `<Text from ${source.name}>\n\n`;
  //       const notionResponse = await this.notionService.getNotionPageBlocksFormatted(source.id);
  //       console.log(notionResponse);
  //       const markdown = renderPageContentToMarkdown(notionResponse.page.blocks, notionResponse.page.title);
  //       console.log(markdown);
  //       infoFromSources += markdown;
  //     }
  //   }
  //   return infoFromSources;
  // }

  async execute(id: string) {
    const task: IAgentTask = await this.findOne(id);

    if (!task) {
      throw new Error('Task not found');
    }

    if (task.assignedType === AssignedType.USER) {
      throw new Error('Cannot execute a task assigned to a user');
    }

    if (!task.agentTask) {
      task.agentTask = {};
    }
    if (!task.agentTask.agentCards || task.agentTask.agentCards.length === 0) {
      if (task.agentCard) {
        task.agentTask.agentCards = [task.agentCard];
      }
    }

    let infoFromSources = null;

    if (task?.agentTask?.sources?.length > 0) {
      const sources = await this.sourcesService.findManyByIds(task.agentTask.sources.map(source => source.id));
      for (const source of sources) {
        infoFromSources += `\n\n<Text from ${source.name}>\n\n`;
        infoFromSources += source.content;
      }
      console.log('-> Getting info from sources: ', infoFromSources.slice(0, 100), '...');
    }

    const results = [];

    if (!task.agentTask?.agentCards?.length) {
      return await this.executeTaskNoAgent(task, infoFromSources);
    } else if (task.taskType === AgentTaskType.CREATE_CONTENT) {
      return await this.executeContentTask(task, infoFromSources);
    } else if (task.taskType === AgentTaskType.REVIEW_TASK) {
      return await this.executeReviewTask(task, infoFromSources);
    }
  }

  private async executeReviewTask(task: IAgentTask, infoFromSources: string) {
    const results = [];
    console.log('-> Reviewing task: ', task.name);
    const jobs = (await this.agentJobService.findByTaskAttachedIdToday(task.agentTask?.taskAttached?.id)) as unknown as IAgentOutcomeJob[];
    for (const finishedJob of jobs) {
      console.log(`-> Evaluando Job: ${finishedJob?.task?.name} - ${finishedJob?.agentCard?.name} `);

      for (const agentCardMinimal of task.agentTask.agentCards) {
        console.log(`-> Agente encargado: ${agentCardMinimal.name}`);
        const agentCard: IAgentCard = await this.conversationAiService.getConversationById(agentCardMinimal.id);
        const chatMessages = buildInitialConversation(agentCard);
        const textToReview = finishedJob.response.content;
        infoFromSources = textToReview;
        chatMessages.push({ role: ChatRole.System, content: `This is the text to review: ${textToReview}` });

        chatMessages.push({ role: ChatRole.User, content: task.description });

        const response = await this.callPythonAgent(chatMessages, task);
        console.log('-> Response: ', response.content.slice(0, 100) + '...');
        const job: IAgentOutcomeJob = {
          task: { id: task.id, name: task.name },
          agentCard: { id: agentCard.id, assets: agentCard.assets,  name: agentCard?.characterCard?.data?.name || agentCard.name },
          messages: chatMessages as MessageAI[],
          response: response,
          responseFormat: 'text',
          sources: task.agentTask?.sources,
          infoFromSources: infoFromSources,
        };
        const jobCreated = await this.agentJobService.save(job);
        console.log(`-> Job created: ${jobCreated.task.name} by ${jobCreated.agentCard.name}`);

        // const notionResponse = await this.postInNotion(task, agentCard, response.content);

        results.push(jobCreated);
      }
    }
    console.log('-> Jobs found: ', jobs.length);
    return jobs;
  }

  private async executeContentTask(task: IAgentTask, infoFromSources: string) {
    let results = [];

    for (const agentCardMinimal of task.agentTask.agentCards) {
      const agentCard: IAgentCard = await this.conversationAiService.getConversationById(agentCardMinimal.id);
      const chatMessages = buildInitialConversation(agentCard);

      if (infoFromSources) {
        chatMessages.push({
          role: ChatRole.System,
          content: 'This is the information from the sources: \n\n' + infoFromSources,
        });
      }

      chatMessages.push({ role: ChatRole.User, content: task.description + taskPrompt });

      if (agentCard.characterCard?.data?.post_history_instructions) {
        chatMessages.push({ role: ChatRole.System, content: agentCard.characterCard.data.post_history_instructions });
      }

      const request: ChatLLMRequestAdapter = {
        messages: chatMessages as MessageLLM[],
        model: task.agentTask?.model || null,
        returnJson: true,
      };
      // Probably in need a flag is is adapter or not.
      const response = await this.aiServicesClient.llm.chat(request);
      console.log('response from client chat return json???: ', response.json.content.slice(0, 100));

      const job: IAgentOutcomeJob = {
        task: { id: task.id, name: task.name },
        agentCard: { id: agentCard.id, assets: agentCard.assets,  name: agentCard?.characterCard?.data?.name || agentCard.name },
        messages: chatMessages as MessageAI[],
        // Check for now these are duplicated, response should be ai response not the object
        response: response.json,
        result: response,
        responseFormat: 'text',
        sources: task.agentTask?.sources,
        infoFromSources: infoFromSources,
      };

      const jobCreated = await this.agentJobService.save(job);
      console.log('finished job for: ', jobCreated?.task?.name);
      results.push(jobCreated);
    }
    return results;
  }

  private async executeTaskNoAgent(task: IAgentTask, infoFromSources: string) {
    const chatMessages = [];
    if (infoFromSources) {
      chatMessages.push({
        role: ChatRole.System,
        content: 'This is the information from the sources: \n\n' + infoFromSources,
      });
    }
    chatMessages.push({ role: ChatRole.User, content: task.description });

    const response = await this.callPythonAgent(chatMessages, task);

    const job: IAgentOutcomeJob = {
      task: { id: task.id, name: task.name },
      messages: chatMessages,
      response: response,
      responseFormat: 'text',
      sources: task.agentTask?.sources,
      infoFromSources: infoFromSources,
    };

    const jobCreated = await this.agentJobService.save(job);
    // TODO: ya no tengo que revisar la intención más bien la salida que sea notion.

    if (task.agentTask?.output?.type === OutputTaks.NOTION_PAGE) {
      // this.postInNotion(task, { title: 'No Agent' } as any, response.content);
    }
    return { job: jobCreated, response: response };
  }

  // private async postInNotion(task: ILlmTask, agentCard: IAgentCard, mdContent: string) {
  //   const notionResponse = await this.notionWritesService.createPageWithContentIntoDatabase({
  //     databaseId: task.output.id,
  //     title: task.name,
  //     contentMarkdown: mdContent,
  //     iconUrl: agentCard.assets.image.url,
  //     properties: {
  //       Name: { title: [{ text: { content: task.name } }] },
  //       Date: { date: { start: new Date().toISOString() } },
  //       Agent: { rich_text: [{ text: { content: agentCard?.name ?? 'AI' } }] },
  //     },
  //   });

  //   return notionResponse;
  // }

  // private async createNotionAgentPageAndAddContent(task: ILlmTask, agentCard: IAgentCard, mdContent: string) {
  //   const results = [];

  //   const properties: CreatePageParameters['properties'] = {
  //     Name: { title: [{ text: { content: `${task.name} - ${agentCard.characterCard?.data?.name}` } }] },
  //     Date: { date: { start: new Date().toISOString() } },
  //     Agent: { rich_text: [{ text: { content: agentCard?.name ?? 'AI' } }] },
  //   };

  //   const notionPage = await this.notionWritesService.createDatabaseEntry({
  //     databaseId: task.output.id,
  //     title: task.name,
  //     children: [],
  //     iconUrl: agentCard.assets.image.url,
  //     properties: properties,
  //   });
  //   this.notionWritesService.appendMarkdownToPage(notionPage.page.id, mdContent);

  //   return notionPage;
  // }
}
