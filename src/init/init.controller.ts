import { AllExceptionsHandler, AppException } from '@dataclouder/nest-core';
import { Controller, Get, Param, Res, UseFilters } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { DecodedIdToken } from 'firebase-admin/auth';
import { AppHttpCode } from 'src/common/app-enums';
import { DecodedToken } from 'src/common/token.decorator';
import { AppUserService } from 'src/user/user.service';
import { NestUsersService, UpdateUserClaims } from '@dataclouder/nest-users';
import { AppAuthClaims, AppToken, PermissionClaim, PlanType, RolClaim, RolType } from '@dataclouder/nest-auth';

@ApiTags('init')
@Controller('api/init/user')
@UseFilters(AllExceptionsHandler)
export class InitController {
  constructor(
    private userService: AppUserService,
    private usersAdminService: NestUsersService
  ) {}

  @Get('/')
  async getLoggedUserDataOrRegister(@DecodedToken() token: AppToken, @Res({ passthrough: true }) res): Promise<any> {
    console.log('Getting Data', token);
    const user = await this.userService.findUserByEmail(token.email);

    if (user) {
      return user;
    } else {
      console.log('First time registered', token.uid);
      res.status(AppHttpCode.GoodRefreshToken);
      const user = await this.userService.registerWithToken(token);
      return user;
    }
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
