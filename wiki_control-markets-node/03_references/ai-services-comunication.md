# AI Services Communication

Control Markets communicates with the centralized AI orchestration project, **AI Services**, to perform complex machine learning tasks like video and image generation, or LLM chat completions. 

The communication architecture is designed to be efficient and handle large media assets seamlessly. It utilizes two main libraries provided by the AI Services project:

1. **`@dataclouder/nest-ai-services-sdk`**: A lightweight HTTP client containing `AiServicesSdkClient`.
2. **`@dataclouder/nest-ai-services-mongodb`**: A shared database schema housing the `GeneratedAsset` entity and associated services.

## The "Asset ID" Communication Pattern

Passing large media assets (images, videos, long prompts) over standard REST HTTP bodies can be slow and prone to timeouts. To mitigate this, Control Markets and AI Services use a Database-First communication pattern:

1. **Prepare Data (Control Markets)**: A Node Processor (such as `VideoGenNodeProcessor` or `NanoBananaNodeProcessor`) extracts the required inputs from the flow execution state.
2. **Save to Database (Control Markets)**: The processor creates a new `GeneratedAsset` document containing the prompt, model configurations, and input media references (like `firstFrame` URLs), and saves it to MongoDB using `GeneratedAssetService.save()`.
3. **Trigger SDK (Control Markets)**: The processor calls a method in the `AiServicesSdkClient` passing *only* the ID of the newly saved asset.
   - Example: `await this.clientAIService.image.generateNanoBananaFromAssetId(savedAsset.id);`
4. **Process & Update (AI Services)**: AI Services receives the ID, queries MongoDB for the payload, executes the AI generation, uploads the result to Cloud Storage, and sets the final output URL on the `GeneratedAsset` record.
5. **Complete Execution (Control Markets)**: The Node Processor can either await the synchronous HTTP response containing the final outcome, or listen to an `asset.updated` event from the database to mark the execution Job as `COMPLETED`.

## Available SDK Endpoints

The `AiServicesSdkClient` exposes domains like `.video`, `.image`, `.llm`, `.tts`, and `.stt`. Look inside the SDK source or utilize TypeScript intellisense for available methods. The preferred method for media-heavy generation is always the `fromAssetId` approach. 
