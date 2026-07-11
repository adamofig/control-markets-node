import { Controller, Get, Patch, Body, Param, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { SourcesService } from '../services/sources.service';
import { SourceDocument } from '../schemas/sources.schema';
import { EntityMongoController } from '@dataclouder/nest-mongo';

@Controller('api/sources')
@ApiTags('Sources')
export class SourcesController extends EntityMongoController<SourceDocument> {
  constructor(private readonly sourcesService: SourcesService) {
    super(sourcesService);
  }

  @Get('youtube-transcript')
  @ApiOperation({ summary: 'Get YouTube transcript by URL' })
  getYoutubeTranscript(@Query('url') url: string) {
    console.log(url);
    return this.sourcesService.getYoutubeTranscript(url);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Partially update a source using dot-notation flattening' })
  patch(@Param('id') id: string, @Body() updateSourceLLMDto: any) {
    return this.sourcesService.partialUpdateFlattened(id, updateSourceLLMDto);
  }
}
