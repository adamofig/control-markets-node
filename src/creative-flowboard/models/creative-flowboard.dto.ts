import { ApiProperty } from '@nestjs/swagger';
import { IFlowEdge, IFlowNode } from '../models/creative-flowboard.models';

export class WebhookNodeDto {
  @ApiProperty({
    description: 'The ID of the flow',
    example: '68fea63e6d6f53d6713cc0d0',
  })
  flowId: string;

  @ApiProperty({
    description: 'The ID of the node',
    example: 'task-node-3MCQgufl3qTzmZVF3DkXS',
  })
  nodeId: string;

  @ApiProperty({
    description: 'The ID of the conversation',
    example: '3',
  })
  conversationId: string;

  @ApiProperty({
    description: 'The ID of the account in chatwoot',
    example: '1',
  })
  accountId: string;
}

export class AddNodesDto {
  @ApiProperty({ description: 'The ID of the flow', example: '68fea63e6d6f53d6713cc0d0' })
  flowId: string;

  @ApiProperty({ description: 'The nodes to add', example: [] })
  nodes: IFlowNode[];

  @ApiProperty({ description: 'The edges to add', example: [] })
  edges: IFlowEdge[];
}
