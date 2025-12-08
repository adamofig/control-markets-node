import { Body, Controller, Param, Patch } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger';
import { VideoGeneratorService } from '../services/video-project-generator.service';
import { IVideoProjectGenerator } from '../models/video-project.models';
import { VideoGeneratorDocument, VideoGeneratorEntity } from '../schemas/video-project.entity';
import { EntityController } from '@dataclouder/nest-mongo';

@ApiTags('video-generator')
@Controller('api/video-generator')
export class VideoGeneratorController extends EntityController<VideoGeneratorDocument> {
  constructor(private readonly videoGeneratorService: VideoGeneratorService) {
    super(videoGeneratorService);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Update a newComponent item' })
  @ApiResponse({ status: 200, description: 'The item has been successfully updated.', type: VideoGeneratorEntity })
  async partialUpdateGranular(
    @Param('id') id: string,
    @Body() updateVideoProject: Partial<IVideoProjectGenerator>
  ): Promise<VideoGeneratorEntity> {
    return (await this.videoGeneratorService.partialUpdateFlattend(id, updateVideoProject)) as VideoGeneratorEntity;
  }

  // @Post('query')
  // @ApiOperation({ summary: 'Create a new newComponent item' })
  // @ApiResponse({ status: 201, description: 'The item has been successfully created.', type: VideoGeneratorEntity })
  // async query(@Body() filterConfig: FiltersConfig): Promise<IQueryResponse<VideoGeneratorEntity>> {
  //   return await this.videoGeneratorService.queryUsingFiltersConfig(filterConfig);
  // }

  @Patch(':id/add-source/:sourceId')
  async addSourceToProject(@Param('id') id: string, @Param('sourceId') sourceId: string) {
    return this.videoGeneratorService.addSourceToVideoProject(id, sourceId);
  }

  @Patch(':id/add-agent-card/:agentCardId')
  async addAgentCardToProject(@Param('id') id: string, @Param('agentCardId') agentCardId: string) {
    return this.videoGeneratorService.addAgentCardToVideoProject(id, agentCardId);
  }

  @Patch(':id/remove-source/:sourceId')
  async removeSourceFromProject(@Param('id') id: string, @Param('sourceId') sourceId: string) {
    return this.videoGeneratorService.removeSourceFromVideoProject(id, sourceId);
  }
}
