# Creating a New Node Processor

Adding logic for a new node type in the backend is designed to be straightforward. You only need to implement a new strategy without modifying the core execution engine.

## Step-by-Step Guide

### 1. Create a New Processor
Create a new TypeScript class in `src/creative-flowboard/services/node-processors/`.
Example: `custom-task.processor.ts`

### 2. Implement the `INodeProcessor` Interface
Your class must implement the `INodeProcessor` interface and provide the `processJob` method.

```typescript
import { Injectable } from '@nestjs/common';
import { INodeProcessor } from './inode.processor';
import { IJobExecutionState, ITaskExecutionState, ICreativeFlowBoard, IExecutionResult, StatusJob } from '../../models/creative-flowboard.models';

@Injectable()
export class CustomTaskProcessor implements INodeProcessor {
  async processJob(
    job: IJobExecutionState,
    task: ITaskExecutionState,
    flow: ICreativeFlowBoard
  ): Promise<Partial<IExecutionResult>> {
    // 1. Implementation logic goes here
    // 2. Return the result
    return {
      status: StatusJob.COMPLETED,
      statusDescription: 'Process finished successfully',
      outputEntityId: 'some-id'
    };
  }
}
```

### 3. Register in `CreativeFlowboardModule`
Add your new processor to the `providers` array in `src/creative-flowboard/creative-flowboard.module.ts`.

```typescript
@Module({
  providers: [
    // ... other providers
    CustomTaskProcessor,
  ],
})
export class CreativeFlowboardModule {}
```

### 4. Register in `NodeProcessorService`
Inject your processor into the `NodeProcessorService` and register it in the `processors` map.

```typescript
// src/creative-flowboard/services/node-processor.service.ts

constructor(
  // ... other processors
  private customTaskProcessor: CustomTaskProcessor,
) {
  this.processors.set(NodeType.CustomTaskComponent, this.customTaskProcessor);
}
```

## Best Practices

- **Use LLM Services**: If your node requires AI, use the `LlmService` or `PromptBuilderService` for consistent prompt handling.
- **Update Status**: Ensure you return a clear `statusDescription` to help users debug their flows.
- **Error Handling**: Throw errors if something goes wrong; the `FlowRunner` will catch them and mark the job as `FAILED`.
