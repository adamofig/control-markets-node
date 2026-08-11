import { Body, Controller, DefaultValuePipe, Get, ParseIntPipe, Post, Query, UnauthorizedException, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { AppToken } from '@dataclouder/nest-auth';
import { AppGuard } from '@dataclouder/nest-core';
import { ProjectAuthGuard } from 'src/user/project-auth.guard';
import { DecodedToken } from 'src/common/token.decorator';
import { AppUserService } from 'src/user/user.service';
import { RecentResourcesService } from '../services/recent-resources.service';
import { TrackResourceDto } from '../models/recent-resources.models';

@ApiTags('recent-resources')
@ApiBearerAuth()
@UseGuards(AppGuard, ProjectAuthGuard)
@Controller('api/recent-resources')
export class RecentResourcesController {
  constructor(
    private readonly recentResourcesService: RecentResourcesService,
    private readonly userService: AppUserService,
  ) {}

  @Post()
  @ApiOperation({ summary: 'Track a recently accessed resource' })
  async trackResource(@DecodedToken() token: AppToken, @Body() dto: TrackResourceDto) {
    return this.recentResourcesService.trackResource(await this.resolveUserId(token), dto);
  }

  @Get()
  @ApiOperation({ summary: 'Get recent resources for the current user' })
  async getRecents(
    @DecodedToken() token: AppToken,
    @Query('limit', new DefaultValuePipe(5), ParseIntPipe) limit: number,
  ) {
    return this.recentResourcesService.getRecentForUser(await this.resolveUserId(token), limit);
  }

  /**
   * Estas rutas son "los recursos recientes **de una persona**", así que sin fila en `users` no hay
   * nada que devolver — no una lista vacía, un caller que esta sección no sabe representar.
   *
   * Se volvió alcanzable al pasar el guard de clase de `AuthGuard` a `ProjectAuthGuard`: antes solo
   * entraban tokens de Firebase, que siempre traen un email registrado. Ahora también entran el token
   * maestro y los `cm_pat_*`, y el maestro **sin `SYSTEM_MASTER_USER`** corre como principal sintético
   * (`system_root`), que a propósito no existe en la colección. Sin esto, `user.id` tiraba un
   * `TypeError` y el cliente veía un 500 donde el problema es de credencial.
   */
  private async resolveUserId(token: AppToken): Promise<string> {
    const user = token?.email ? await this.userService.findUserByEmail(token.email) : null;
    if (!user) {
      throw new UnauthorizedException('This endpoint needs a caller with a user account; the credential resolved to none.');
    }
    return user.id;
  }
}
