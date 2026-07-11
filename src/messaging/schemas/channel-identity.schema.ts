import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import mongoose, { Document } from 'mongoose';
import { addIdAfterSave } from '@dataclouder/nest-mongo';
import { ChannelType, IdentityStatus } from '../models/messaging.models';

export type ChannelIdentityDocument = ChannelIdentityEntity & Document;

/**
 * Vincula un usuario/org de Control Markets con su dirección en un canal externo.
 * Opt-in por diseño: sin identidad `verified`, el gateway descarta el mensaje.
 */
@Schema({ collection: 'channel_identities', timestamps: true })
export class ChannelIdentityEntity {
  @Prop({ required: false })
  id: string;

  @Prop({ required: true })
  userId: string;

  @Prop({ required: true })
  orgId: string;

  @Prop({ type: String, required: true, enum: Object.values(ChannelType) })
  channel: ChannelType;

  /** chatId de Telegram, número E.164 en WhatsApp. Vacío mientras el link está pendiente. */
  @Prop({ required: false })
  address?: string;

  @Prop({ type: String, required: true, default: 'pending' })
  status: IdentityStatus;

  /** Token de un solo uso para el deep-link t.me/<bot>?start=<token>. */
  @Prop({ required: false })
  linkToken?: string;

  @Prop({ required: false })
  linkTokenExpiresAt?: Date;

  @Prop({ required: false })
  verifiedAt?: Date;

  /** Nombre visible en el canal (first_name/username de Telegram). */
  @Prop({ required: false })
  displayName?: string;

  /** Perfil agéntico que atiende las conversaciones de esta identidad (multi-agent routing). */
  @Prop({ required: false })
  agenticProfileId?: string;

  @Prop({ required: false })
  deviceId?: string;

  @Prop({ type: mongoose.Schema.Types.Mixed, required: false })
  metadata?: Record<string, unknown>;
}

export const ChannelIdentitySchema = SchemaFactory.createForClass(ChannelIdentityEntity);

addIdAfterSave(ChannelIdentitySchema);

ChannelIdentitySchema.index({ id: 1 }, { unique: true });
ChannelIdentitySchema.index({ channel: 1, address: 1 });
ChannelIdentitySchema.index({ linkToken: 1 }, { sparse: true });
ChannelIdentitySchema.index({ userId: 1, orgId: 1 });
