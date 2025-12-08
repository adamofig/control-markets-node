import { Body, Controller, Param, Get, Post, UseFilters, UseGuards, Delete } from '@nestjs/common';
import { ApiBearerAuth, ApiTags, ApiOperation } from '@nestjs/swagger';

import { AllExceptionsHandler } from 'src/common/exception-hanlder.filter';
import { UserClaimsDto } from './admin.dto';
import { AdminService } from './admin.service';
import { AppAuthClaims, FirebaseService } from '@dataclouder/nest-auth';

@ApiTags('admin')
@ApiBearerAuth()
@Controller('api/admin')
@UseFilters(AllExceptionsHandler)
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
    const appClaims: AppAuthClaims = { plan: claims.plan, permissions: claims.permissions, roles: claims.roles };

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
