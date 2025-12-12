import { Body, Controller, Delete, Get, Post, Res, UseFilters, UseGuards } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { UserEntity } from './user.entity';
import { Model } from 'mongoose';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { DecodedToken } from 'src/common/token.decorator';
import { DecodedIdToken } from 'firebase-admin/auth';
import { AppUserService } from './user.service';
import { AppHttpCode } from 'src/common/app-enums';
import { IUser } from './user.class';
import { AllExceptionsHandler } from 'src/common/exception-hanlder.filter';
import { AppToken, AuthGuard } from '@dataclouder/nest-auth';
import { AppGuard } from '@dataclouder/nest-core';
import { EntityController } from '@dataclouder/nest-mongo';
import { OrganizationService } from 'src/organization/services/organization.service';

@ApiTags('user')
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
  @Get('/logged')
  async getLoggedUserDataOrRegister(@DecodedToken() token: AppToken, @Res({ passthrough: true }) res): Promise<any> {
    console.log('Getting user Data', token.uid);
    const user = await this.userService.findUserByEmail(token.email);

    if (user) {
      return user;
    } else {
      res.status(AppHttpCode.GoodRefreshToken);
      // This 2 should be toguether user and organization, if i need to refactor create ainit
      const user = await this.userService.registerWithToken(token);
      const organization = await this.organizationService.save({ name: user.email, description: user.email, type: 'personal' }, user.id);
      user.defaultOrgId = organization.id;
      await user.save();
      return user;
    }
  }

  // This is replace by the one in init.controller
}
