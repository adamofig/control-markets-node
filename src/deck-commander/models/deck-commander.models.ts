import { IAuditable } from '@dataclouder/nest-core';

export enum CommandType {
  Button = 'button',
}

export interface IDeckCommander {
  _id?: string;
  id?: string;
  name?: string;
  description?: string;
  img?: string;
  type?: CommandType;
  command?: string;
  action?: string;
  emoji?: string;
  auditable?: IAuditable;
}
