import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';
import * as mongoose from 'mongoose';
import { addIdAfterSave } from '@dataclouder/nest-mongo';
import { CommandType, IDeckCommander } from '../models/deck-commander.models';
import { IAuditable } from '@dataclouder/nest-core';
export type DeckCommanderDocument = DeckCommanderEntity & Document;

@Schema({ collection: 'DeckCommander', timestamps: true })
export class DeckCommanderEntity implements IDeckCommander {
  @Prop({ type: mongoose.Schema.Types.ObjectId, required: false })
  id: string;
  @Prop({ required: false })
  name: string;

  @Prop({ required: false })
  description: string;

  @Prop({ required: false })
  content: string;

  @Prop({ required: false })
  img: string;

  @Prop({ type: String, required: false })
  type: CommandType;

  @Prop({ required: false })
  command: string;

  @Prop({ required: false })
  action: string;

  @Prop({ required: false })
  emoji: string;

  @Prop({ type: mongoose.Schema.Types.Mixed, required: false })
  auditable: IAuditable;
}

export const DeckCommanderSchema = SchemaFactory.createForClass(DeckCommanderEntity);

addIdAfterSave(DeckCommanderSchema);
