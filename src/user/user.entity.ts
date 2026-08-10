import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import mongoose, { Document } from 'mongoose';
import { IUser, IUserOrganization, PersonalData, UserSettings } from './user.class';
import { AppAuthClaims, AudioSpeed } from '@dataclouder/nest-auth';
import { addIdAfterSave } from '@dataclouder/nest-mongo';

@Schema({ collection: 'users' })
export class UserEntity extends Document implements IUser {
  @Prop()
  id: string = '';

  @Prop()
  fbId: string = '';

  @Prop({ type: mongoose.Schema.Types.String, required: false })
  email: string;

  @Prop({ type: mongoose.Schema.Types.String, required: false })
  urlPicture: string;

  @Prop({ type: mongoose.Schema.Types.String, required: false })
  authStrategy: string;

  @Prop({ type: mongoose.Schema.Types.Mixed, required: false })
  claims: AppAuthClaims;

  @Prop({ type: mongoose.Schema.Types.String, required: false })
  defaultOrgId: string;

  @Prop({ type: mongoose.Schema.Types.Mixed, required: false })
  personalData: PersonalData;

  @Prop({ type: mongoose.Schema.Types.Mixed, required: false })
  organizations: IUserOrganization[];

  @Prop({ type: String, required: false })
  token?: string;

  @Prop({
    default: {
      baseLanguage: 'es',
      targetLanguage: 'en',
      audioSpeed: AudioSpeed.Regular,
      enableNotifications: true,
      wordsNumber: 3,
      conversation: {
        synthVoice: true,
        realTime: false,
        repeatRecording: false,
        fixGrammar: false,
        superHearing: false,
        autoTranslate: true,
        highlightWords: false,
        assistantMessageTask: true,
        userMessageTask: true,
      },
    },
  })
  settings: UserSettings;
}

export const UserSchema = SchemaFactory.createForClass(UserEntity);
addIdAfterSave(UserSchema);
UserSchema.index({ id: 1 });
UserSchema.index({ token: 1 }, { unique: true, sparse: true });
// Equality lookups that run on nearly every request (`findUserByEmail` in init/user/recent-resources,
// and the auth guard resolving a caller by fbId). Without these they are collection scans.
UserSchema.index({ fbId: 1 });
UserSchema.index({ email: 1 });
// Backs the members table: users.find({ 'organizations.orgId': orgId }).
UserSchema.index({ 'organizations.orgId': 1 });
UserSchema.index({ email: 'text', 'personalData.firstname': 'text', 'personalData.lastname': 'text', 'personalData.emotionalName': 'text' });
