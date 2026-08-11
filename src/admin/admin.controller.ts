import { Body, Controller, Param, Get, Post, UseGuards, Delete } from '@nestjs/common';
import { ApiBearerAuth, ApiTags, ApiOperation } from '@nestjs/swagger';

import { UserClaimsDto } from './admin.dto';
import { AdminService } from './admin.service';
import { AppAuthClaims, FirebaseService } from '@dataclouder/nest-auth';
import { AppGuard } from '@dataclouder/nest-core';
import { ProjectAuthGuard } from 'src/user/project-auth.guard';

/**
 * F10: guarded. This controller edits Firebase custom claims and deletes accounts by email — it was
 * fully anonymous, so `POST /api/admin/claims` was a one-request path to platform admin.
 *
 * TODO(F11): authentication is not enough here. Every route needs a platform-admin check on top
 * (`isPlatformAdmin` from `src/auth/platform-roles.ts`); today any authenticated user still reaches it.
 */
@ApiTags('admin')
@ApiBearerAuth()
@UseGuards(AppGuard, ProjectAuthGuard)
@Controller('api/admin')
export class AdminController {
  constructor(
    private readonly firebaseService: FirebaseService,
    private adminService: AdminService
  ) {}

  @Get('/claims/:email')
  @ApiOperation({ summary: 'Get Custom Claims From Firebase', description: 'Get Custom Claims From Firebase' })
  async getClaims(@Param('email') email: string): Promise<any> {
    return await this.firebaseService.getClaimsByEmail(email);
  }

  // prabablemente debe llamarse claims
  @Post('/claims')
  @ApiOperation({ summary: 'Update user claims', description: 'pass valid claims to update' })
  async updateClaims(@Body() claims: UserClaimsDto): Promise<any> {
    claims.email = claims.email.toLowerCase();
    if (claims.plan.exp) {
      claims.plan.exp = new Date(claims.plan.exp);
    }
    // TODO: probably i need to change permissions to save in Date instead of string
    const appClaims: AppAuthClaims = { plan: claims.plan, permissions: claims.permissions, roles: claims.roles, userId: null };

    console.log('Double check this methods is not overwriting user claims userId. that is handled in updateClaimsByEmail ');

    const update = await this.adminService.updateClaimsByEmail(claims.email, appClaims);
    console.log('update', update);
    return appClaims;
  }

  @Delete('/user/:email')
  @ApiOperation({ summary: 'delete user' })
  async deleteUser(@Param('email') email: string): Promise<any> {
    const results = await this.adminService.deleteUserByEmail(email);
    return results;
  }
}
