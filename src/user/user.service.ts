import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';

import { UserEntity } from './user.entity';
import { Model } from 'mongoose';

import { FirebaseService, AppAuthClaims, PermissionClaim, PlanType, RolClaim, AppToken } from '@dataclouder/nest-auth';

import { IUser } from './user.class';
import { EntityCommunicationService } from '@dataclouder/nest-mongo';
import { MongoService } from '@dataclouder/nest-mongo';

/**
 * Service for managing user data and authentication
 * Provides methods for user registration, retrieval, updates, and deletion
 */
@Injectable()
export class AppUserService extends EntityCommunicationService<UserEntity> {
  constructor(
    @InjectModel(UserEntity.name) private userModel: Model<UserEntity>,
    private firebaseService: FirebaseService,
    mongoService: MongoService
  ) {
    super(userModel, mongoService);
  }

  /**
   * Finds a user by their email address
   * @param email - The email address of the user to find
   * @returns Promise resolving to the user data or null if not found
   */
  public async findUserByEmail(email: string): Promise<any> {
    const user = await this.userModel.findOne({ email: email }).lean();
    return user;
  }

  /**
   * Finds a user by their ID
   * @param id - The ID of the user to find
   * @returns Promise resolving to the user data or null if not found
   */
  public async findUserById(id: string): Promise<Partial<IUser>> {
    const user = await this.userModel.findOne({ id: id }).lean().exec();
    return user;
  }

  /**
   * Every user holding a membership in the given organization. Backed by the
   * `organizations.orgId` index; the projection keeps claims, tokens and settings out of the result.
   */
  public async findOrgMembers(orgId: string): Promise<any[]> {
    return this.userModel
      .find({ 'organizations.orgId': orgId }, { id: 1, email: 1, urlPicture: 1, personalData: 1, organizations: 1 })
      .lean()
      .exec();
  }

  /**
   * Creates the shell document that holds an invitation for an email with no account yet.
   *
   * It is deliberately missing `fbId` — that absence is what marks it as un-hydrated, and what
   * `findOrRegisterWithToken` looks for when that person eventually signs in.
   */
  public async createInvitedUser(email: string): Promise<any> {
    const claims: AppAuthClaims = { plan: { type: PlanType.Basic }, permissions: {} as PermissionClaim, roles: {} as RolClaim, userId: null };
    const created = await new this.userModel({ email, claims, organizations: [] }).save();
    return created.toObject ? created.toObject() : created;
  }

  /**
   * Resolves the caller's user document at sign-in, hydrating a pending invitation if one exists.
   *
   * Without this, an invited shell (created by `addUserToOrganization` for an email with no account)
   * would be returned as-is on first login — leaving the account with no `fbId`, no claims and no
   * auth strategy, and its memberships stuck on `invited`.
   */
  public async findOrRegisterWithToken(token: AppToken): Promise<{ user: any; created: boolean }> {
    const existing = await this.userModel.findOne({ email: token.email }).exec();

    if (!existing) {
      const user = await this.registerWithToken(token);
      return { user: user.toObject ? user.toObject() : user, created: true };
    }

    if (existing.fbId) {
      return { user: existing.toObject(), created: false };
    }

    existing.fbId = token.uid;
    existing.urlPicture = existing.urlPicture || token.picture || '';
    existing.authStrategy = token.firebase?.sign_in_provider;
    existing.personalData = { ...(existing.personalData ?? {}), firstname: existing.personalData?.firstname || token.name || token.email.split('@')[0] } as any;
    existing.organizations = (existing.organizations ?? []).map(org => (org.status === 'invited' ? { ...org, status: 'active' as const } : org));

    const claims = existing.claims ?? ({ plan: { type: PlanType.Basic }, permissions: {} as PermissionClaim, roles: {} as RolClaim, userId: null } as AppAuthClaims);
    claims.userId = existing.id || existing._id.toString();
    existing.claims = claims;
    existing.markModified('organizations');
    existing.markModified('claims');

    const hydrated = await existing.save();
    this.firebaseService.setClaimsFirstTime(hydrated.fbId, claims);

    return { user: hydrated.toObject(), created: true };
  }

  /**
   * Registers a new user using a decoded Firebase token
   * Sets up basic claims and creates a user record in the database
   * @param token - The decoded Firebase ID token containing user information
   * @returns Promise resolving to the newly created user
   */
  public async registerWithToken(token: AppToken): Promise<UserEntity> {
    const claims: AppAuthClaims = { plan: { type: PlanType.Basic }, permissions: {} as PermissionClaim, roles: {} as RolClaim, userId: null };

    const user: Partial<IUser> = {
      fbId: token.uid,
      email: token.email,
      urlPicture: token.picture ?? '',

      personalData: {
        firstname: token.name ?? token.email.split('@')[0],
      },

      claims: claims, // no se porque en polilan no los agrego aquí.
      authStrategy: token.firebase.sign_in_provider,
    };

    // TODO: se envia desde el frontend, solo necesito modificar las notificaciones del usuario.
    if (!token.email_verified) {
      // TODO:  send email verification
    }

    const newUser = new this.userModel(user);
    const userSaved = await newUser.save();
    // i have the id after save, but just in case.
    const firstUserId = userSaved.id || newUser._id.toString();

    claims.userId = firstUserId;
    this.firebaseService.setClaimsFirstTime(userSaved.fbId, claims);

    return userSaved;
  }

  /**
   * Deletes a user from both the database and Firebase
   * @param userId - The ID of the user to delete
   * @returns Promise resolving to the deletion result
   */
  public async deleteUserByEmail(email: string): Promise<any> {
    const users = await this.userModel.deleteOne({ email: email }).exec();

    await this.firebaseService.deleteUserByEmail(email);
    return users;
  }

  /**
   * Updates a user's information by their ID
   * @param userId - The ID of the user to update
   * @param user - Partial user object containing the fields to update
   * @returns Promise resolving to the updated user
   */
  public async updateUser(userId: string, user: Partial<IUser>): Promise<any> {
    const userUpdated = await this.userModel.findOneAndUpdate({ id: userId }, { $set: user }, { new: true }).lean().exec();
    // new return document after update, if false return before update
    return userUpdated;
  }

  /**
   * Updates a user's information by their email address
   * @param email - The email of the user to update
   * @param user - Partial user object containing the fields to update
   * @returns Promise resolving to the update result
   */
  public async updateUserByEmail(email: string, user: Partial<IUser>): Promise<any> {
    const results = await this.userModel.updateOne({ email: email }, { $set: user }).lean().exec();
    return results;
  }
}
