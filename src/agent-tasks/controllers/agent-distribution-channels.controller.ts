import { Controller, Get, Post, Body, Param, Put, Delete, Query, Patch, UseGuards } from '@nestjs/common';
import { AppGuard } from '@dataclouder/nest-core';
import { ProjectAuthGuard } from 'src/user/project-auth.guard';
import { ApiOperation, ApiResponse, ApiTags, ApiProperty } from '@nestjs/swagger';
import { AgentDistributionChannelService } from '../services/agent-distribution-channel.service';
import { AppException } from '@dataclouder/nest-core';

export class IPostToDistributionChannel {
  @ApiProperty({ example: '6845d6274849c1bbb32a6bf6', description: 'The ID of the job' })
  id: string;

  @ApiProperty({ example: 'blog', description: 'The distribution channel' })
  channel: string;
}

@UseGuards(AppGuard, ProjectAuthGuard)
@Controller('api/agent-distribution-channels')
@ApiTags('Agent Distribution Channels')
export class AgentDistributionChannelsController {
  constructor(private readonly agentDistributionChannelService: AgentDistributionChannelService) {}

  @Post()
  @ApiOperation({ summary: 'Post to distribution channel' })
  create(@Body() createSourceLLMDto: IPostToDistributionChannel) {
    if (createSourceLLMDto.channel === 'blog') {
      return this.agentDistributionChannelService.postToBlog(createSourceLLMDto.id);
    } else {
      throw new AppException({ error_message: 'Invalid distribution channel', explanation: 'todavía no se programa este canal' });
    }
  }
}
