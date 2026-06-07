import { AllExceptionsHandler, AppException } from '@dataclouder/nest-core';
import { Controller, Get, Param, Res, UseFilters } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { DecodedIdToken } from 'firebase-admin/auth';
import { AppHttpCode } from 'src/common/app-enums';
import { DecodedToken } from 'src/common/token.decorator';
import { AppUserService } from 'src/user/user.service';
import { NestUsersService, UpdateUserClaims } from '@dataclouder/nest-users';
import { AppAuthClaims, AppToken, PermissionClaim, PlanType, RolClaim, RolType } from '@dataclouder/nest-auth';
import { OrganizationService } from 'src/organization/services/organization.service';

@ApiTags('init')
@Controller('api/init/user')
@UseFilters(AllExceptionsHandler)
export class InitController {
  constructor(
    private userService: AppUserService,
    private usersAdminService: NestUsersService,
    private organizationService: OrganizationService
  ) {}

  @Get('/')
  async getLoggedUserDataOrRegister(@DecodedToken() token: AppToken, @Res({ passthrough: true }) res): Promise<any> {
    console.log('Getting Data', token);
    let user = await this.userService.findUserByEmail(token.email);

    if (!user) {
      console.log('First time registered', token.uid);
      res.status(AppHttpCode.GoodRefreshToken);
      user = await this.userService.registerWithToken(token);
    }

    // Proactively initialize the personal organization if it doesn't exist yet
    const personalOrg = await this.organizationService.findOneByQuery({ name: user.email, type: 'personal' });
    if (!personalOrg) {
      console.log('Creating personal organization for user', user.email);
      // We force the personal organization _id to be the user's MongoDB _id (which is a valid ObjectId)
      const userIdStr = user._id.toString();
      const organization = await this.organizationService.save(
        { name: user.email, description: `Personal space for ${user.email}`, type: 'personal' },
        userIdStr
      );
      
      // Update user's defaultOrgId if it's unset or pointing to their Firebase UID string
      if (!user.defaultOrgId || user.defaultOrgId === user.id) {
        user.defaultOrgId = organization.id;
        user = await this.userService.updateUser(user.id, { defaultOrgId: organization.id });
      }
    } else if (!user.defaultOrgId || user.defaultOrgId === user.id) {
      // If the personal organization exists, but the user's defaultOrgId is unset or points to the Firebase UID, sync it
      user.defaultOrgId = personalOrg.id;
      user = await this.userService.updateUser(user.id, { defaultOrgId: personalOrg.id });
    }

    return user;
  }


  @Get('/create-first-admin/:email')
  async createFirstAdmin(@Param('email') email: string) {
    throw new AppException({ error_message: 'You need to refactor method. ', explanation: 'first admin need user id passed not only email, or lookup user by email and get id' });

    const authClaims: AppAuthClaims = {
      plan: { type: PlanType.Premium, exp: null },
      permissions: {} as PermissionClaim,
      roles: { [RolType.Admin]: null } as RolClaim,
      userId: null,
    };
    const user = await this.usersAdminService.updateClaimsByEmail(email, authClaims);
    return user;
  }
}
