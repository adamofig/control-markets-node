import { Injectable } from '@nestjs/common';
import { IAgentCard, buildInitialConversation, parseConversation, ChatRole, ChatMessage } from '@dataclouder/nest-agent-cards';
import { IAgentOutcomeJob, IAgentSource, ILlmTask, AgentTaskType } from 'src/agent-tasks/models/classes';
import { IFlowNode, NodeType } from '../models/agent-flows.models';
import { outcomePromptTemplate } from './flow-prompt-templates';

@Injectable()
export class PromptBuilderService {
  public async build(task: ILlmTask, inputNodeData: IAgentCard | IAgentOutcomeJob, sourceNodes: IFlowNode[] = [], nodeType: NodeType): Promise<ChatMessage[]> {
    let chatMessages: ChatMessage[] = [];
    if (nodeType === NodeType.AgentNodeComponent) {
      chatMessages = buildInitialConversation(inputNodeData as IAgentCard);
      parseConversation(chatMessages, { char: (inputNodeData as IAgentCard)?.characterCard?.data?.name || 'Persona Agent', user: 'User' });
      const personaPrompt = 'Stay in character and speak as the character would, Take on the persona, Use his mannerisms, speech patterns, and personality';

      chatMessages.push({ role: ChatRole.System, content: personaPrompt });
    } else if (nodeType === NodeType.OutcomeNodeComponent) {
      const agentOutcomeJob = inputNodeData as IAgentOutcomeJob;
      const requestPrompt = outcomePromptTemplate(agentOutcomeJob, task);
      const messagesReq = { role: ChatRole.User, content: requestPrompt };
      return [messagesReq];
    }

    const taskPrompt = task.description;
    if (sourceNodes.length > 0) {
      let agentSourceContent = '';
      for (const sourceNode of sourceNodes) {
        const agentSource: IAgentSource = sourceNode.data.nodeData;
        agentSourceContent += '\n' + agentSource.content + '\n';
      }

      chatMessages.push({
        role: ChatRole.System,
        content: `You are provided with information and sources try to use it, or at least take inspiration from it when perfroming the task: \n<context> ${agentSourceContent} \n</context>\n`,
      });
    }
    if (task.taskType === AgentTaskType.CREATE_CONTENT) {
      const jsonStructure = `You must return only this json stucture, 
      **description**: is a brief description of the content less than 25 words, 
      **tags**: are categories for the content like, hook, english, learning, science etc. 
      **content**: is the requested text and your task to generate the content.
      here is the json to return: 
      {content: string, description: string, tags: string[]}`;
      chatMessages.push({ role: ChatRole.User, content: taskPrompt + jsonStructure });
    } else {
      chatMessages.push({ role: ChatRole.User, content: taskPrompt });
    }

    return chatMessages;
  }
}
