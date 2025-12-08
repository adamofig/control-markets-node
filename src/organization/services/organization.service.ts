import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { OrganizationEntity, OrganizationDocument } from '../schemas/organization.schema';
import { MongoService } from '@dataclouder/nest-mongo';
import { EntityCommunicationService } from '@dataclouder/nest-mongo';
import { AppUserService } from 'src/user/user.service';
import { IUserOrganization } from 'src/user/user.class';
import { AppException } from '@dataclouder/nest-core';

/**
 * Service for managing organization entities in the database
 * Provides CRUD operations and query capabilities for OrganizationEntity objects
 */
/**
 * Service for managing organization entities in the database
 * Provides CRUD operations and query capabilities for OrganizationEntity objects
 * @description
 * This service provides methods for creating, retrieving, updating, and deleting organization entities
 * It also provides a query method that takes a filters configuration object and returns a promise resolving to a query response containing results and metadata
 */
@Injectable()
export class OrganizationService extends EntityCommunicationService<OrganizationDocument> {
  constructor(
    @InjectModel(OrganizationEntity.name)
    private organizationModel: Model<OrganizationDocument>,
    mongoService: MongoService,
    private readonly userService: AppUserService
  ) {
    super(organizationModel, mongoService);
  }

  async addUserToOrganization(orgId: string, email: string): Promise<any> {
    const user = await this.userService.findUserByEmail(email);
    if (!user) {
      throw new AppException({ error_message: `User with email ${email} not found` });
    }

    const organization = await this.organizationModel.findById(orgId).exec();
    if (!organization) {
      throw new AppException({ error_message: `Organization with id ${orgId} not found` });
    }

    const newOrg: IUserOrganization = {
      orgId: organization._id.toString(),
      name: organization.name,
      roles: ['member'], // default role
    };

    if (!user.organizations) {
      user.organizations = [];
    }

    // Avoid adding duplicate organizations
    const orgExists = user.organizations.some(org => org.orgId === newOrg.orgId);
    if (orgExists) {
      return user; // Or throw a BadRequestException
    }

    user.organizations.push(newOrg);

    // Add user to organization's guest list
    if (!organization.guests) {
      organization.guests = [];
    }
    organization.guests.push({ userId: user.id, email: user.email });
    await organization.save();

    return await this.userService.updateUser(user.id, { organizations: user.organizations });
  }
}
