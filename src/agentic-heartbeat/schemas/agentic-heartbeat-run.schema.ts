import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import mongoose, { Document } from 'mongoose';
import { addIdAfterSave } from '@dataclouder/nest-mongo';

export type AgenticHeartbeatRunDocument = AgenticHeartbeatRunEntity & Document;

export type HeartbeatRunStatus = 'running' | 'completed' | 'failed';
export type HeartbeatRunTrigger = 'cron' | 'manual';

export interface IHeartbeatToolCall {
  toolName: string;
  input?: unknown;
  output?: unknown;
}

@Schema({ collection: 'agentic_heartbeat_runs', timestamps: true })
export class AgenticHeartbeatRunEntity {
  @Prop({ required: false })
  id: string;

  @Prop({ required: false })
  orgId: string;

  @Prop({ required: true })
  profileId: string;

  @Prop({ required: false })
  profileName?: string;

  @Prop({ required: true })
  trigger: HeartbeatRunTrigger;

  @Prop({ required: true })
  engine: string;

  @Prop({ required: false })
  prompt?: string;

  @Prop({ required: true, default: 'running' })
  status: HeartbeatRunStatus;

  @Prop({ required: false })
  output?: string;

  @Prop({ type: mongoose.Schema.Types.Mixed, required: false, default: [] })
  toolCalls?: IHeartbeatToolCall[];

  @Prop({ required: false })
  error?: string;

  @Prop({ required: false })
  startedAt?: Date;

  @Prop({ required: false })
  finishedAt?: Date;

  @Prop({ required: false })
  durationMs?: number;

  @Prop({ type: mongoose.Schema.Types.Mixed, required: false })
  usage?: {
    stopReason?: string;
    inputTokens?: number;
    outputTokens?: number;
    totalTokens?: number;
    thoughtTokens?: number;
    cachedReadTokens?: number;
    cachedWriteTokens?: number;
  };
}

export const AgenticHeartbeatRunSchema = SchemaFactory.createForClass(AgenticHeartbeatRunEntity);

addIdAfterSave(AgenticHeartbeatRunSchema);

AgenticHeartbeatRunSchema.index({ id: 1 }, { unique: true });
AgenticHeartbeatRunSchema.index({ profileId: 1, createdAt: -1 });
AgenticHeartbeatRunSchema.index({ orgId: 1 });
