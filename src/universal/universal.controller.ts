import { Body, Controller, Get, Param, Post, UseGuards } from '@nestjs/common';
import { ApiBody, ApiOperation, ApiParam, ApiResponse, ApiTags } from '@nestjs/swagger';
import { DecodedToken } from '@dataclouder/nest-auth';
import { ProjectAuthGuard } from 'src/user/project-auth.guard';
import { UniversalService } from './universal.service';
import { UniversalOperationDto } from './dto/universal-operation.dto';

@ApiTags('Universal')
@Controller('api/universal')
export class UniversalController {
  constructor(private readonly universalService: UniversalService) {}

  @Get('entities')
  @UseGuards(ProjectAuthGuard)
  @ApiOperation({ summary: 'List entities available for universal operations' })
  getEntities() {
    return this.universalService.getRegisteredEntities();
  }

  @Post(':entity/operation')
  @UseGuards(ProjectAuthGuard)
  @ApiOperation({
    summary: 'Execute a database operation on any registered entity (PAT-first auth)',
    description: `Same body contract as /api/{entity}/operation, but authenticated with ProjectAuthGuard (PAT cm_pat_* first, Firebase fallback).
      Supported actions: 'findOne', 'find', 'create', 'updateOne', 'updateMany', 'deleteOne', 'deleteMany', 'aggregate'.`,
  })
  @ApiParam({ name: 'entity', description: "Registered entity key, e.g. 'agent-tasks', 'organization'" })
  @ApiBody({ type: UniversalOperationDto })
  @ApiResponse({ status: 200, description: 'The operation was successful.' })
  @ApiResponse({ status: 404, description: 'Entity not registered.' })
  executeOperation(@Param('entity') entity: string, @Body() operationDto: UniversalOperationDto, @DecodedToken() token: any) {
    return this.universalService.executeOperation(entity, operationDto, token?.email);
  }
}
