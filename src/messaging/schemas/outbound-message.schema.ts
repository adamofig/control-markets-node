import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';
import { addIdAfterSave } from '@dataclouder/nest-mongo';
import { ChannelType, OutboundSource, OutboundStatus } from '../models/messaging.models';

export type OutboundMessageDocument = OutboundMessageEntity & Document;

/** Auditoría de todo mensaje saliente de la plataforma hacia canales externos. */
@Schema({ collection: 'outbound_messages', timestamps: true })
export class OutboundMessageEntity {
  @Prop({ required: false })
  id: string;

  @Prop({ required: true })
  orgId: string;

  @Prop({ required: false })
  userId?: string;

  @Prop({ type: String, required: true, enum: Object.values(ChannelType) })
  channel: ChannelType;

  @Prop({ required: true })
  address: string;

  @Prop({ required: true })
  text: string;

  @Prop({ type: String, required: true, default: 'queued' })
  status: OutboundStatus;

  @Prop({ type: String, required: false })
  source?: OutboundSource;

  /** Referencia al origen: taskId, heartbeat runId, etc. */
  @Prop({ required: false })
  sourceRef?: string;

  @Prop({ required: false })
  providerMessageId?: string;

  @Prop({ required: false })
  error?: string;

  @Prop({ required: false })
  sentAt?: Date;
}

export const OutboundMessageSchema = SchemaFactory.createForClass(OutboundMessageEntity);

addIdAfterSave(OutboundMessageSchema);

OutboundMessageSchema.index({ id: 1 }, { unique: true });
OutboundMessageSchema.index({ orgId: 1, createdAt: -1 });
OutboundMessageSchema.index({ userId: 1, createdAt: -1 });
