import { NestFactory } from '@nestjs/core';
import { CreativeFlowboardModule } from '../creative-flowboard.module';
import { NodeProcessorService } from '../services/node-processor.service';
import { ICreativeFlowBoard, NodeType, StatusJob } from '../models/creative-flowboard.models';
import { Logger } from '@nestjs/common';

async function bootstrap() {
  const logger = new Logger('TestNanoBanana');
  const app = await NestFactory.createApplicationContext(CreativeFlowboardModule);
  
  const nodeProcessorService = app.get(NodeProcessorService);

  const mockFlow: ICreativeFlowBoard = {
    id: 'test-flow',
    orgId: 'test-org',
    nodes: [
      {
        id: 'node-1',
        point: { x: 0, y: 0 },
        type: NodeType.NanoBananaNodeComponent,
        config: { component: NodeType.NanoBananaNodeComponent, category: 'process' as any },
        data: {
          nodeData: {
            prompt: 'A cute robot making a banana smoothie, 3d render, high detail',
            model: 'gemini-2.5-flash-image'
          }
        }
      }
    ],
    edges: [],
    metadata: {}
  };

  const mockJob = {
    inputNodeId: 'node-1', // In this case input is the same as process for testing or empty
    processNodeId: 'node-1',
    outputNodeId: 'node-2',
    nodeType: NodeType.NanoBananaNodeComponent,
    processNodeType: NodeType.NanoBananaNodeComponent,
    inputEntityId: '',
    status: StatusJob.PENDING,
    statusDescription: '',
    messages: [],
    outputEntityId: '',
    resultType: '' as any,
    fatherTaskId: 'task-1',
    flowExecutionId: 'exec-1'
  };

  const mockTask = {
    id: 'task-1',
    flowExecutionId: 'exec-1',
    processNodeId: 'node-1',
    entityId: 'node-1',
    nodeType: NodeType.NanoBananaNodeComponent,
    status: StatusJob.PENDING,
    jobs: [mockJob]
  };

  try {
    logger.log('Starting NanoBanana processJob test...');
    const result = await nodeProcessorService.processJob(mockJob, mockTask, mockFlow);
    logger.log('Result:', result);
  } catch (error) {
    logger.error('Test failed:', error.message);
  } finally {
    await app.close();
  }
}

bootstrap();
