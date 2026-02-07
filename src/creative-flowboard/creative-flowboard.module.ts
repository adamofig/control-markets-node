import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { CreativeFlowboardController } from './controllers/creative-flowboard.controller';
import { CreativeFlowboardService } from './services/creative-flowboard.service';
import { FlowBoardEntity, CreativeFlowboardSchema } from './schemas/creative-flowboard.schema';
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
import { CompletionNodeProcessor } from './services/node-processors/completion-node.processor';
import { OutcomeNodeProcessor } from './services/node-processors/outcome-node.processor';
import { FlowStateService } from './services/flow-state.service';
import { VideoGenNodeProcessor } from './services/node-processors/video-processor';
import { FlowExecutionStateEntity, FlowExecutionStateSchema } from './schemas/flow-execution-state.schema';
import { FlowExecutionStateService } from './services/flow-execution-state.service';
import { FlowEventsService } from './services/flow-events.service';
import { NodePromptBuilderService } from './services/flow-node-prompt-builder.service';
import { ChatwootService } from './integrations/chatwoot.service';
import { NanoBananaNodeProcessor } from './services/node-processors/nanobanana-node.processor';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: FlowBoardEntity.name, schema: CreativeFlowboardSchema },
      { name: FlowExecutionStateEntity.name, schema: FlowExecutionStateSchema },
    ]),
    DCMongoDBModule,
    NestStorageModule,
    NestAuthModule,
    AgentCardsModule,
    AgentsModule,
    NestVertexModule,
  ],
  controllers: [CreativeFlowboardController],
  providers: [
    CreativeFlowboardService,
    FlowsDbStateService,
    FlowNodeSearchesService,
    FlowRunnerService,
    NodeProcessorService,
    PromptBuilderService,
    CompletionNodeProcessor,
    OutcomeNodeProcessor,
    FlowStateService,
    VideoGenNodeProcessor,
    NanoBananaNodeProcessor,
    FlowExecutionStateService,
    FlowEventsService,
    NodePromptBuilderService,
    ChatwootService,
  ],
  exports: [CreativeFlowboardService, FlowsDbStateService, FlowExecutionStateService],
})
export class CreativeFlowboardModule {}
