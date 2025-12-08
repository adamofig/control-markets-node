import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { AgentFlowsController } from './controllers/agent-flows.controller';
import { AgentFlowsService } from './services/agent-flows.service';
import { AgentFlowsEntity, AgentFlowsSchema } from './schemas/agent-flows.schema';
import { DCMongoDBModule } from '@dataclouder/nest-mongo';
import { NestStorageModule } from '@dataclouder/nest-storage';
import { FlowsDbStateService } from './services/flows-db-state.service';
import { NestAuthModule } from '@dataclouder/nest-auth';
import { AgentCardsModule } from '@dataclouder/nest-agent-cards';
import { AgentsModule } from 'src/agent-tasks/agent-tasks.module';
import { NestVertexModule } from '@dataclouder/nest-vertex';
import { FlowNodeSearchesService } from './services/flow-searches.service';
import { FlowRunnerService } from './services/flow-runner.service';
import { NodeProcessorService } from './services/node-processor.service';
import { PromptBuilderService } from './services/prompt-builder.service';
import { AgentNodeProcessor } from './services/node-processors/agent-node.processor';
import { OutcomeNodeProcessor } from './services/node-processors/outcome-node.processor';
import { FlowStateService } from './services/flow-state.service';
import { VideoGenNodeProcessor } from './services/node-processors/video-processor';
import { FlowExecutionStateEntity, FlowExecutionStateSchema } from './schemas/flow-execution-state.schema';
import { FlowExecutionStateService } from './services/flow-execution-state.service';
import { FlowEventsService } from './services/flow-events.service';
import { NodePromptBuilderService } from './services/flow-node-prompt-builder.service';
import { ChatwootService } from './integrations/chatwoot.service';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: AgentFlowsEntity.name, schema: AgentFlowsSchema },
      { name: FlowExecutionStateEntity.name, schema: FlowExecutionStateSchema },
    ]),
    DCMongoDBModule,
    NestStorageModule,
    NestAuthModule,
    AgentCardsModule,
    AgentsModule,
    NestVertexModule,
  ],
  controllers: [AgentFlowsController],
  providers: [
    AgentFlowsService,
    FlowsDbStateService,
    FlowNodeSearchesService,
    FlowRunnerService,
    NodeProcessorService,
    PromptBuilderService,
    AgentNodeProcessor,
    OutcomeNodeProcessor,
    FlowStateService,
    VideoGenNodeProcessor,
    FlowExecutionStateService,
    FlowEventsService,
    VideoGenNodeProcessor,
    NodePromptBuilderService,
    ChatwootService,
  ],
  exports: [AgentFlowsService, FlowsDbStateService, FlowExecutionStateService],
})
export class AgentFlowsModule {}
