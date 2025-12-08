import { Controller, Get, Post, Body, Param, Put, Delete, Query, Patch } from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags, ApiProperty } from '@nestjs/swagger';
import { AgentDistributionChannelService } from '../services/agent-distribution-channel.service';
import { IAgentSource } from '../models/classes';
import { AppException } from '@dataclouder/nest-core';

export class IPostToDistributionChannel {
  @ApiProperty({ example: '6845d6274849c1bbb32a6bf6', description: 'The ID of the job' })
  id: string;

  @ApiProperty({ example: 'blog', description: 'The distribution channel' })
  channel: string;
}

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
