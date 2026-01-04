import { IAgentOutcomeJob, ILlmTask } from 'src/agent-tasks/models/classes';

export const outcomePromptTemplate = (agentOutcomeJob: IAgentOutcomeJob, task: ILlmTask) =>
  `You are an expert resolving tasks.
use this information as context to resolve the task:
<context>
    ${agentOutcomeJob?.result?.content}
</context>

### Your task
    ${task.description}
`;
