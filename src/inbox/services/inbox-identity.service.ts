import { ForbiddenException, Injectable, NotFoundException, UnauthorizedException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { AppToken } from '@dataclouder/nest-auth';
import { FilterQuery, Model, Types } from 'mongoose';
import { UserEntity } from '../../user/user.entity';
import { IInboxParticipantSnapshot } from '../models/inbox.models';

export interface InboxActorContext {
  orgId: string;
  userRefId: string;
  participant: IInboxParticipantSnapshot;
}

export interface InboxUserSummary {
  id: string;
  displayName: string;
  email?: string;
  avatarUrl?: string;
}

@Injectable()
export class InboxIdentityService {
  constructor(@InjectModel(UserEntity.name) private readonly userModel: Model<UserEntity>) {}

  async resolveActor(token: AppToken, requestedOrgId?: string): Promise<InboxActorContext> {
    const user = await this.findAuthenticatedUser(token);
    const userRefId = this.userId(user);
    const orgId = requestedOrgId || user.defaultOrgId || userRefId;

    if (!this.belongsToOrganization(user, orgId)) {
      throw new ForbiddenException('You do not belong to the requested organization');
    }

    return {
      orgId,
      userRefId,
      participant: this.toParticipant(user),
    };
  }

  async findOrganizationUser(orgId: string, identifier: string): Promise<IInboxParticipantSnapshot> {
    const normalizedIdentifier = identifier?.trim();
    if (!normalizedIdentifier) throw new NotFoundException('User not found');

    const identityClauses: FilterQuery<UserEntity>[] = [{ id: normalizedIdentifier }, { fbId: normalizedIdentifier }, { email: normalizedIdentifier.toLowerCase() }];
    if (Types.ObjectId.isValid(normalizedIdentifier)) identityClauses.push({ _id: normalizedIdentifier });

    const user = await this.userModel
      .findOne({
        $and: [{ $or: identityClauses }, { $or: this.organizationClauses(orgId) }],
      })
      .lean()
      .exec();

    if (!user) throw new NotFoundException('User not found in this organization');
    return this.toParticipant(user);
  }

  async searchOrganizationUsers(orgId: string, actorRefId: string, search = '', limit = 20): Promise<InboxUserSummary[]> {
    const safeLimit = Math.min(Math.max(Number(limit) || 20, 1), 50);
    const query: FilterQuery<UserEntity> = {
      $and: [{ $or: this.organizationClauses(orgId) }],
    };

    const normalizedSearch = search.trim();
    if (normalizedSearch) {
      const regex = new RegExp(this.escapeRegex(normalizedSearch), 'i');
      query.$and.push({
        $or: [{ email: regex }, { 'personalData.firstname': regex }, { 'personalData.lastname': regex }, { 'personalData.nickname': regex }],
      });
    }

    const users = await this.userModel
      .find(query)
      .limit(safeLimit + 1)
      .lean()
      .exec();
    return users
      .filter(user => this.userId(user) !== actorRefId)
      .slice(0, safeLimit)
      .map(user => ({
        id: this.userId(user),
        displayName: this.displayName(user),
        email: user.email,
        avatarUrl: user.urlPicture,
      }));
  }

  private async findAuthenticatedUser(token: AppToken): Promise<any> {
    const clauses: FilterQuery<UserEntity>[] = [];
    if (token?.email) clauses.push({ email: token.email.toLowerCase() });
    const tokenId = token?.userId || (token as any)?.id || token?.uid;
    if (tokenId) {
      clauses.push({ id: tokenId }, { fbId: tokenId });
      if (Types.ObjectId.isValid(tokenId)) clauses.push({ _id: tokenId });
    }
    if (!clauses.length) throw new UnauthorizedException('Authenticated user identity is required');

    const user = await this.userModel.findOne({ $or: clauses }).lean().exec();
    if (!user) throw new UnauthorizedException('Authenticated user was not found');
    return user;
  }

  private belongsToOrganization(user: any, orgId: string): boolean {
    return this.organizationIds(user).includes(orgId);
  }

  private organizationIds(user: any): string[] {
    return [user.defaultOrgId, user.id, user._id?.toString(), ...(user.organizations || []).map((organization: any) => organization.orgId)].filter(Boolean);
  }

  private organizationClauses(orgId: string): FilterQuery<UserEntity>[] {
    const clauses: FilterQuery<UserEntity>[] = [{ defaultOrgId: orgId }, { 'organizations.orgId': orgId }, { id: orgId }];
    if (Types.ObjectId.isValid(orgId)) clauses.push({ _id: orgId });
    return clauses;
  }

  private toParticipant(user: any): IInboxParticipantSnapshot {
    const refId = this.userId(user);
    return {
      participantId: `user:${refId}`,
      type: 'user',
      refId,
      displayName: this.displayName(user),
    };
  }

  private userId(user: any): string {
    return user.id || user._id?.toString() || user.fbId;
  }

  private displayName(user: any): string {
    const personalData = user.personalData || {};
    return [personalData.firstname, personalData.lastname].filter(Boolean).join(' ') || personalData.nickname || user.email || 'User';
  }

  private escapeRegex(value: string): string {
    return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }
}
