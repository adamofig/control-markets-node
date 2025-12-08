import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';

import { UserEntity } from './user.entity';
import { Model } from 'mongoose';

import { FirebaseService, AppAuthClaims, PermissionClaim, PlanType, RolClaim } from '@dataclouder/nest-auth';

import { DecodedIdToken } from 'firebase-admin/auth';
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
   * Registers a new user using a decoded Firebase token
   * Sets up basic claims and creates a user record in the database
   * @param token - The decoded Firebase ID token containing user information
   * @returns Promise resolving to the newly created user
   */
  public async registerWithToken(token: DecodedIdToken): Promise<any> {
    const claims: AppAuthClaims = { plan: { type: PlanType.Basic }, permissions: {} as PermissionClaim, roles: {} as RolClaim };

    const user: Partial<IUser> = {
      id: token.uid,
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
    this.firebaseService.setClaims(userSaved.id, claims);

    return userSaved;
  }

  /**
   * Deletes a user from both the database and Firebase
   * @param userId - The ID of the user to delete
   * @returns Promise resolving to the deletion result
   */
  public async deleteUser(userId: string): Promise<any> {
    const users = await this.userModel.deleteOne({ id: userId }).exec();

    await this.firebaseService.deleteUser(userId);
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
