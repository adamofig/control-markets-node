import { ChatMessage } from '@dataclouder/nest-agent-cards';
import { AppException } from '@dataclouder/nest-core';
import { ChatRole } from '@dataclouder/nest-ai-services-sdk';

import { Injectable } from '@nestjs/common';
import axios from 'axios';
import * as https from 'https';

export interface ChatwootMessage {
  id: number;
  content: string;
  account_id: number;
  inbox_id: number;
  conversation_id: number;
  message_type: 0 | 1 | 2;
  created_at: number;
  updated_at: number;
  private: boolean;
  status: 'sent' | 'delivered' | 'read' | 'failed';
  source_id: string;
  content_type: 'text' | 'input_select' | 'cards' | 'form';
  content_attributes: object;
  sender_type: 'contact' | 'agent' | 'agent_bot';
  sender_id: number;
  external_source_ids: object;
  additional_attributes: object;
  processed_message_content: string;
  sentiment: object;
  conversation: object;
  attachment: object;
  sender: object;
}

export enum MessageType {
  INCOMING = 0,
  OUTGOING = 1,
  OTHER = 2,
}

@Injectable()
export class ChatwootService {
  private readonly httpsAgent = new https.Agent({
    rejectUnauthorized: false,
  });

  private readonly chatwootApi = axios.create({
    baseURL: process.env.CHATWOOT_HOST + '/api/v1',
    headers: { api_access_token: process.env.CHATWOOT_API_KEY }, // Assuming you have an API key in your .env
    httpsAgent: this.httpsAgent,
  });

  async getConversation(inbox_identifier: string, contact_identifier: string, conversation_id: string): Promise<any> {
    try {
      // The public API doesn't use the token, so we create a temporary instance or call axios directly.
      const url = `${process.env.CHATWOOT_HOST}/public/api/v1/inboxes/${inbox_identifier}/contacts/${contact_identifier}/conversations/${conversation_id}`;
      console.log('MAKING REQUEST TO: ', url);
      const response = await axios.get(url, { httpsAgent: this.httpsAgent });
      return response.data;
    } catch (error) {
      console.error('Error fetching conversation from Chatwoot:', error);
      throw error;
    }
  }

  async getApplicationMessages({ account_id = '1', conversation_id }: { account_id: string; conversation_id: string }): Promise<any> {
    try {
      const uri = `/accounts/${account_id}/conversations/${conversation_id}/messages`;
      console.log('MAKING REQUEST TO: ', this.chatwootApi.defaults.baseURL + uri);
      const response = await this.chatwootApi.get(uri);
      const messages = this.castToChatMessage(response.data.payload);
      return messages;
    } catch (error) {
      console.error('getApplicationMessages() -> Error fetching messages from Chatwoot:', error?.message);
      if (error.status === 404) {
        throw new AppException({ error_message: 'Conversation not found double check the conversation id and account id', explanation: error?.message });
      }
      throw new AppException({ error_message: 'Error fetching messages from Chatwoot', explanation: error?.message });
    }
  }

  castToChatMessage(messages: ChatwootMessage[]): ChatMessage[] {
    return messages.map(message => {
      return {
        role: message.message_type === MessageType.INCOMING ? ChatRole.User : ChatRole.Assistant,
        content: message.content,
      };
    });
  }
}
