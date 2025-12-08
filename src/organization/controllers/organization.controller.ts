import { Controller, Post, Body, Param } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { OrganizationService } from '../services/organization.service';

import { EntityController } from '@dataclouder/nest-mongo';
import { OrganizationDocument } from '../schemas/organization.schema';

class AddUserToOrganizationDto {
  email: string;
}

@ApiTags('organization')
@Controller('api/organization') // NOT ENDPOINT Father will tell
export class OrganizationController extends EntityController<OrganizationDocument> {
  constructor(private readonly organizationService: OrganizationService) {
    super(organizationService);
  }

  @Post(':orgId/add-user')
  async addUserToOrganization(@Param('orgId') orgId: string, @Body() addUserToOrganizationDto: AddUserToOrganizationDto) {
    return this.organizationService.addUserToOrganization(orgId, addUserToOrganizationDto.email);
  }
}
