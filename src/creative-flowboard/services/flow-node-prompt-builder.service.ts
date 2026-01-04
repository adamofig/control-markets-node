import { Injectable, Logger } from '@nestjs/common';
import { IFlowNode, NodeType } from '../models/creative-flowboard.models';
import { ChatMessage, IAgentCard } from '@dataclouder/nest-agent-cards';
import { groupBy } from 'es-toolkit/array';
import { ChatRole } from '@dataclouder/nest-vertex';

export enum SectionType {
  Intro = 'intro',
  Persona = 'persona',
  Context = 'context',
  Rules = 'rules',
}

export enum SystemPromptType {
  SystemPrompt = 'system_prompt',
  ConversationType = 'conversation_type',
  CharacterIdentity = 'character_identity',
  CharacterAppearance = 'character_appearance',
  CharacterPersonality = 'character_personality',
  CharacterCommunication = 'character_communication',
  CharacterPsychology = 'character_psychology',
  CharacterBackground = 'character_background',
  CharacterCapabilities = 'character_capabilities',
  CharacterSocial = 'character_social',
  CharacterPreferences = 'character_preferences',
  CharacterSituation = 'character_situation',
  CharacterDescription = 'character_description',
  Language = 'language',
  UserInformation = 'user_information',
  ScenarioDescription = 'scenario_description',
  MessageExamples = 'message_examples',
}

export enum PersonaExtractionLevel {
  BASIC = 'basic',
  MEDIUM = 'medium',
  FULL = 'full',
}

@Injectable()
export class NodePromptBuilderService {
  private logger = new Logger(NodePromptBuilderService.name);
  constructor() {}

  public getContextPrompts(nodes: IFlowNode[]): ChatMessage[] {
    const groupedInputNodes = groupBy(nodes, item => item.config.component);
    const sourceNodes = groupedInputNodes[NodeType.SourcesNodeComponent] || [];
    let markdownContent = '';

    if (sourceNodes.length > 0) {
      for (const source of sourceNodes) {
        const nodeData = source.data.nodeData;
        if (nodeData.tag === 'rule') {
          markdownContent += `## Rule: ${nodeData.name}\n${nodeData.content}\n\n`;
        } else {
          markdownContent += `## Context: ${nodeData.name}\n${nodeData.content}\n\n`;
        }
      }
    }

    if (markdownContent.length > 0) {
      return [{ role: ChatRole.System, content: markdownContent }];
    }

    return [];
  }

  public getAgentCardPersonaMessage(agentCard: IAgentCard, level: PersonaExtractionLevel): ChatMessage | null {
    const personaMessages = this.getAgentCardPersona(agentCard, level);
    if (personaMessages.length === 0) {
      return null;
    }

    let markdownContent = '### Character Persona\n';
    markdownContent += `You are role playing with this character, everything you do try to act and speak like you where ${agentCard.characterCard?.data?.name} here are the description of the character\n\n`;
    markdownContent += personaMessages.join('');

    return { role: ChatRole.System, content: markdownContent };
  }

  public getAgentCardPersona(agentCard: IAgentCard, level: PersonaExtractionLevel): string[] {
    const characterCard = agentCard.characterCard;

    if (!characterCard?.data?.persona) {
      return [];
    }

    const persona = characterCard.data.persona;

    const personaMapping: { [key: string]: { messageId: SystemPromptType; section: SectionType } } = {
      identity: { messageId: SystemPromptType.CharacterIdentity, section: SectionType.Persona },
      physical: { messageId: SystemPromptType.CharacterAppearance, section: SectionType.Persona },
      personality: { messageId: SystemPromptType.CharacterPersonality, section: SectionType.Persona },
      communication: { messageId: SystemPromptType.CharacterCommunication, section: SectionType.Persona },
      psychology: { messageId: SystemPromptType.CharacterPsychology, section: SectionType.Persona },
      background: { messageId: SystemPromptType.CharacterBackground, section: SectionType.Persona },
      capabilities: { messageId: SystemPromptType.CharacterCapabilities, section: SectionType.Persona },
      social: { messageId: SystemPromptType.CharacterSocial, section: SectionType.Persona },
      preferences: { messageId: SystemPromptType.CharacterPreferences, section: SectionType.Persona },
      situation: { messageId: SystemPromptType.CharacterSituation, section: SectionType.Persona },
    };

    const personaFields: { [key in PersonaExtractionLevel]: (keyof typeof persona)[] } = {
      [PersonaExtractionLevel.BASIC]: ['personality', 'communication', 'capabilities'],
      [PersonaExtractionLevel.MEDIUM]: ['personality', 'communication', 'capabilities', 'psychology', 'background', 'preferences'],
      [PersonaExtractionLevel.FULL]: Object.keys(personaMapping) as (keyof typeof persona)[],
    };

    const fieldsToExtract = personaFields[level];
    const messages: string[] = [];

    for (const field of fieldsToExtract) {
      if (persona[field]) {
        const title = field.charAt(0).toUpperCase() + field.slice(1);
        messages.push(`### ${title}\n${persona[field]}\n\n`);
      }
    }

    return messages;
  }
}
