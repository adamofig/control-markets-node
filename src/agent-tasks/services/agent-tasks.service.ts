import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';

import { firstValueFrom } from 'rxjs';
import { HttpService } from '@nestjs/axios';
import { CreatePageParameters } from '@notionhq/client/build/src/api-endpoints';
// @dataclouder libs
import { FiltersConfig, IQueryResponse, MongoService } from '@dataclouder/nest-mongo';
// import { NotionService, NotionWritesService, renderPageContentToMarkdown } from 'libs/nest-notion/src';
import { buildInitialConversation, ChatRole, AgentCardService, IAgentCard, ChatMessage } from '@dataclouder/nest-agent-cards';
// local
import { AgentTaskEntity, AgentTaskDocument } from '../schemas/agent-task.schema';
import { AgentTaskType, IAgentOutcomeJob, ILlmTask, ISourceTask, MessageAI, OutputTaks } from '../models/classes';
import { AgentOutcomeJobService } from './agent-job.service';
import { AgentSourcesService } from './agent-sources.service';
import { ChatLLMRequestAdapter, AiServicesSdkClient, MessageLLM } from '@dataclouder/nest-ai-services-sdk';
import { taskPrompt } from '../prompts/task-prompts';
import { AppException } from '@dataclouder/nest-core';
@Injectable()
export class AgentTasksService {
  constructor(
    @InjectModel(AgentTaskEntity.name)
    private agentTaskModel: Model<AgentTaskDocument>,
    private conversationAiService: AgentCardService,
    private httpService: HttpService,
    // private notionWritesService: NotionWritesService,
    // private notionService: NotionService,
    private agentJobService: AgentOutcomeJobService,
    private mongoService: MongoService,
    private agentSourcesService: AgentSourcesService,
    private aiServicesClient: AiServicesSdkClient
  ) {}

  async findAll() {
    return this.agentTaskModel.find().exec();
  }

  async findOne(id: string): Promise<AgentTaskEntity> {
    return await this.agentTaskModel.findById(id).lean().exec();
  }

  async create(createAgentTaskDto: ILlmTask) {
    const createdTask = new this.agentTaskModel(createAgentTaskDto);
    return createdTask.save();
  }

  async queryUsingFiltersConfig(filterConfig: FiltersConfig): Promise<IQueryResponse<AgentTaskEntity>> {
    return await this.mongoService.queryUsingFiltersConfig(filterConfig, this.agentTaskModel);
  }

  async save(createAgentTaskDto: ILlmTask) {
    const id = createAgentTaskDto.id || createAgentTaskDto._id;
    if (createAgentTaskDto?.agentCard?.id) {
      // TODO: fix this to only get assets
      const agentCard = await this.conversationAiService.getConversationById(createAgentTaskDto.agentCard.id);
      const { assets, title } = agentCard;
      createAgentTaskDto.agentCard = { id: createAgentTaskDto.agentCard.id, assets, title, name: agentCard?.characterCard?.data?.name };
    }
    if (id) {
      return this.update(id, createAgentTaskDto);
    } else {
      delete createAgentTaskDto._id;
      delete createAgentTaskDto.id;
      const createdTask = new this.agentTaskModel(createAgentTaskDto);
      return createdTask.save();
    }
  }

  async update(id: string, updateAgentTaskDto: any) {
    return this.agentTaskModel.findByIdAndUpdate(id, updateAgentTaskDto, { new: true }).exec();
  }

  async delete(id: string) {
    return this.agentTaskModel.findByIdAndDelete(id).exec();
  }

  async callPythonAgent(chatMessages: ChatMessage[], task: ILlmTask): Promise<{ content: string; role: string; metadata: any }> {
    const request = {
      messages: chatMessages,
      modelName: task.model.modelName,
      provider: task.model.provider,
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
    const task: ILlmTask = await this.findOne(id);

    if (!task) {
      throw new Error('Task not found');
    }

    let infoFromSources = null;

    if (task?.sources?.length > 0) {
      const sources = await this.agentSourcesService.findManyByIds(task.sources.map(source => source.id));
      for (const source of sources) {
        infoFromSources += `\n\n<Text from ${source.name}>\n\n`;
        infoFromSources += source.content;
      }
      console.log('-> Getting info from sources: ', infoFromSources.slice(0, 100), '...');
    }

    const results = [];

    if (task.agentCards.length == 0) {
      return await this.executeTaskNoAgent(task, infoFromSources);
    } else if (task.taskType === AgentTaskType.CREATE_CONTENT) {
      return await this.executeContentTask(task, infoFromSources);
    } else if (task.taskType === AgentTaskType.REVIEW_TASK) {
      return await this.executeReviewTask(task, infoFromSources);
    }
  }

  private async executeReviewTask(task: ILlmTask, infoFromSources: string) {
    const results = [];
    console.log('-> Reviewing task: ', task.name);
    const jobs = (await this.agentJobService.findByTaskAttachedIdToday(task.taskAttached.id)) as unknown as IAgentOutcomeJob[];
    for (const finishedJob of jobs) {
      console.log(`-> Evaluando Job: ${finishedJob?.task?.name} - ${finishedJob?.agentCard?.title} `);

      for (const agentCardMinimal of task.agentCards) {
        console.log(`-> Agente encargado: ${agentCardMinimal.name} - ${agentCardMinimal.title}`);
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
          agentCard: { id: agentCard.id, assets: agentCard.assets, title: agentCard.title, name: agentCard?.characterCard?.data?.name },
          messages: chatMessages as MessageAI[],
          response: response,
          responseFormat: 'text',
          sources: task.sources,
          infoFromSources: infoFromSources,
        };
        const jobCreated = await this.agentJobService.create(job);
        console.log(`-> Job created: ${jobCreated.task.name} by ${jobCreated.agentCard.title}`);

        // const notionResponse = await this.postInNotion(task, agentCard, response.content);

        results.push(jobCreated);
      }
    }
    console.log('-> Jobs found: ', jobs.length);
    return jobs;
  }

  private async executeContentTask(task: ILlmTask, infoFromSources: string) {
    let results = [];

    for (const agentCardMinimal of task.agentCards) {
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
        model: task.model || null,
        returnJson: true,
      };
      // Probably in need a flag is is adapter or not.
      const response = await this.aiServicesClient.llm.chat(request);
      console.log('response from client chat return json???: ', response.json.content.slice(0, 100));

      const job: IAgentOutcomeJob = {
        task: { id: task.id, name: task.name },
        agentCard: { id: agentCard.id, assets: agentCard.assets, title: agentCard.title, name: agentCard?.characterCard?.data?.name },
        messages: chatMessages as MessageAI[],
        // Check for now these are duplicated, response should be ai response not the object
        response: response.json,
        result: response,
        responseFormat: 'text',
        sources: task.sources,
        infoFromSources: infoFromSources,
      };

      const jobCreated = await this.agentJobService.create(job);
      console.log('finished job for: ', jobCreated?.task?.name);
      results.push(jobCreated);
    }
    return results;
  }

  private async executeTaskNoAgent(task: ILlmTask, infoFromSources: string) {
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
      sources: task.sources,
      infoFromSources: infoFromSources,
    };

    const jobCreated = await this.agentJobService.create(job);
    // TODO: ya no tengo que revisar la intención más bien la salida que sea notion.

    if (task.output.type === OutputTaks.NOTION_PAGE) {
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
  //       Agent: { rich_text: [{ text: { content: agentCard?.title ?? 'AI' } }] },
  //     },
  //   });

  //   return notionResponse;
  // }

  // private async createNotionAgentPageAndAddContent(task: ILlmTask, agentCard: IAgentCard, mdContent: string) {
  //   const results = [];

  //   const properties: CreatePageParameters['properties'] = {
  //     Name: { title: [{ text: { content: `${task.name} - ${agentCard.characterCard?.data?.name}` } }] },
  //     Date: { date: { start: new Date().toISOString() } },
  //     Agent: { rich_text: [{ text: { content: agentCard?.title ?? 'AI' } }] },
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
