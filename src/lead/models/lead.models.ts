import { IAssetable, IAuditable } from '@dataclouder/nest-core';
import { ChatMessage } from '@dataclouder/nest-agent-cards';

export interface ILead {
  _id?: string;
  id?: string;
  orgId?: string;

  name?: string;
  description?: string;

  fullName?: string;
  phoneNumber?: string;

  assets: IAssetable;
  auditable?: IAuditable;

  phoneNumberData?: PhoneNumberData;
  messages?: ChatMessage[];
  conversationAnalysis?: any;
}

export interface PhoneNumberData {
  countryCode: string;
  areaCode: string;
  country: string;
  state: string;
  municipality: string;
  fullNumber: string;
}
