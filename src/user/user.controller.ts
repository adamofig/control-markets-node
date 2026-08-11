import { Body, Controller, Delete, Get, Post, Res, UseFilters, UseGuards } from '@nestjs/common';
import { randomBytes } from 'crypto';
import { InjectModel } from '@nestjs/mongoose';
import { UserEntity } from './user.entity';
import { Model } from 'mongoose';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { DecodedToken } from 'src/common/token.decorator';
import { AppUserService } from './user.service';
import { AppHttpCode } from 'src/common/app-enums';
import { AllExceptionsHandler } from 'src/common/exception-hanlder.filter';
import { AppToken, AuthGuard } from '@dataclouder/nest-auth';
import { AppGuard } from '@dataclouder/nest-core';
import { EntityController } from '@dataclouder/nest-mongo';
import { OrganizationService } from 'src/organization/services/organization.service';
import { AccountScoped } from 'src/auth/account-scoped.decorator';
import { NotOrgScoped } from 'src/auth/not-org-scoped.decorator';

@ApiTags('user')
@NotOrgScoped('The users collection has no orgId field: membership lives in organizations[].orgId, so filtering by orgId returns nothing. Scoping user reads is F17 work, not a field rewrite.')
@ApiBearerAuth()
@UseGuards(AppGuard, AuthGuard)
@Controller('api/user')
@UseFilters(AllExceptionsHandler)
export class UserController extends EntityController<UserEntity> {
  constructor(
    @InjectModel(UserEntity.name) private userModel: Model<UserEntity>,
    private userService: AppUserService,
    private organizationService: OrganizationService
  ) {
    super(userService);
  }

  // This is replace by the one in init.controller
  @AccountScoped('Legacy twin of GET /api/init/user: it also registers the account and its personal organization, so it cannot require a membership that does not exist yet.')
  @Get('/logged')
  async getLoggedUserDataOrRegister(@DecodedToken() token: AppToken, @Res({ passthrough: true }) res): Promise<any> {
    console.log('Getting user Data', token.uid);
    const { user, created } = await this.userService.findOrRegisterWithToken(token);

    if (!created) {
      return user;
    }

    res.status(AppHttpCode.GoodRefreshToken);
    // This 2 should be toguether user and organization, if i need to refactor create ainit
    const organization = await this.organizationService.save({ name: user.email, description: user.email, type: 'personal' }, user.id);
    return this.userService.updateUser(user.id, { defaultOrgId: organization.id });
  }

  @Post('/regenerate-token')
  async regenerateToken(@DecodedToken() token: AppToken): Promise<{ token: string }> {
    const pat = `cm_pat_${Date.now().toString(36)}${randomBytes(3).toString('hex').slice(0, 5)}`;
    await this.userModel.updateOne({ fbId: token.uid }, { $set: { token: pat } }).exec();
    return { token: pat };
  }

  // This is replace by the one in init.controller
}
