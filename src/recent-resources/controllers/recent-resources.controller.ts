import { Body, Controller, DefaultValuePipe, Get, ParseIntPipe, Post, Query, UseFilters, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { AppToken, AuthGuard } from '@dataclouder/nest-auth';
import { AppGuard } from '@dataclouder/nest-core';
import { AllExceptionsHandler } from 'src/common/exception-hanlder.filter';
import { DecodedToken } from 'src/common/token.decorator';
import { AppUserService } from 'src/user/user.service';
import { RecentResourcesService } from '../services/recent-resources.service';
import { TrackResourceDto } from '../models/recent-resources.models';

@ApiTags('recent-resources')
@ApiBearerAuth()
@UseGuards(AppGuard, AuthGuard)
@Controller('api/recent-resources')
@UseFilters(AllExceptionsHandler)
export class RecentResourcesController {
  constructor(
    private readonly recentResourcesService: RecentResourcesService,
    private readonly userService: AppUserService,
  ) {}

  @Post()
  @ApiOperation({ summary: 'Track a recently accessed resource' })
  async trackResource(@DecodedToken() token: AppToken, @Body() dto: TrackResourceDto) {
    const user = await this.userService.findUserByEmail(token.email);
    return this.recentResourcesService.trackResource(user.id, dto);
  }

  @Get()
  @ApiOperation({ summary: 'Get recent resources for the current user' })
  async getRecents(
    @DecodedToken() token: AppToken,
    @Query('limit', new DefaultValuePipe(5), ParseIntPipe) limit: number,
  ) {
    const user = await this.userService.findUserByEmail(token.email);
    return this.recentResourcesService.getRecentForUser(user.id, limit);
  }
}
