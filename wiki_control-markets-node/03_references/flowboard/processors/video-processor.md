# Video Gen Node Processor

The `VideoGenNodeProcessor` is responsible for orchestrating video generation workflows within the Control Markets platform. It acts as a bridge between the flow execution engine and the AI backend services.

## Technical Overview

The processor implements the `INodeProcessor` interface and is dispatched by the `NodeProcessorService` when a node of type `AssetsNodeComponent` is executed.

### Key Responsibilities
- **Data Extraction**: Retrieves configuration from both the Asset node (source files) and the Video Generation node (prompt and settings).
- **Persistence**: Creates a new record in the `GeneratedAsset` collection with the necessary metadata.
- **AI Triggering**: Communicates with the AI Services backend to start the generation process.
- **Status Management**: Tracks the progress of the generation and updates the flow execution state.

## Execution Flow

The processing flow follows a specific sequence to ensure high-quality generation and real-time feedback:

### 1. Context Resolution
The processor identifies the inputs for the generation:
- **Input Node(s) (`inputNodeIds`/`inputNodeId`)**: The source assets (images, audio). For multi-input workflows like `image-audio-to-video`, the execution engine consolidates all connected nodes into the `inputNodeIds` field of the job.
- **Process Node (`processNodeId`)**: The `VideoGenNodeComponent` containing the generation parameters (provider, prompt, workflow, etc.).

### 2. Multi-Input Support: image-audio-to-video

When the workflow is set to `image-audio-to-video`, the processor uses the `FlowNodeSearchesService` to discover all input nodes connected to the video generation node.

- **Audio Discovery**: Searches for a node with `component: AudioNodeComponent`.
- **Image Discovery**: Searches for a node with `component: AssetsNodeComponent`.

These are then mapped to the `assets` object as `firstAudio` and `firstFrame` respectively.

### 3. GeneratedAsset Creation
Before calling the AI service, the processor saves a `GeneratedAsset` entity to MongoDB. This entity acts as the "Job Ticket" for the AI backend.

```typescript
  assets: assets,                                                // Maps to firstFrame, and firstAudio if available
  prompt: processNodeData?.prompt,                                       // User prompt
  description: processNodeData?.description,                           // Optional description
  request: processNodeData?.request,                                   // Provider-specific settings
  provider: processNodeData.provider,                                  // e.g., 'veo', 'comfy'
  workflow: processNodeData.workflow,                                  // e.g., 'image-audio-to-video'
};
```


#### The Role of IAssetsForGeneration

In order to generate a video usaully need images, audios or videos. The `IAssetsForGeneration` interface is used to specify the source assets for the video generation process. and is and object that stores Cloud Object Storages, follow the dataclouder/nest-storage library that is usally object with url, so ai backend can download the file and use it for generation.


### 3. AI Service Notification
The processor calls the AI backend using the `AiServicesSdkClient`. It passes the `GeneratedAsset` ID, allowing the backend to retrieve the full context and settings autonomously.

```typescript
await this.clientAIService.video.generateFromAssetId(newGeneratedAsset.id);
```

### 4. Async Completion & Real-time Integration
Video generation is an asynchronous process. The processor handles completion in two ways:
- **Direct Completion**: If the SDK call is synchronous (rare for video).
- **Event-Driven**: It listens for the `asset.updated` event (emitted when the AI backend finishes and updates the MongoDB record) to mark the job as `COMPLETED` in the flow state.

## Configuration Settings

The `request` object sent to the AI service is the most critical part of the integration. It translates the UI settings into a format the AI services understand:

- **Provider**: Determines which AI engine to use (Veo, ComfyUI, etc.).
- **Prompt**: The core text instruction for the video.
- **Request Settings**: Includes parameters like aspect ratio, duration, or specific ComfyUI workflow IDs. These are passed directly to the AI service to ensure the right model and configuration are used.

## Error Handling
If the AI service call fails, the processor captures the error message and updates the job status to `FAILED`, providing feedback through the real-time execution tracking system.
