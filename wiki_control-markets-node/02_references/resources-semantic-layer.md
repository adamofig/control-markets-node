# Control Markets - Semantic Layer Model Analysis

This document outlines the core objects identified in Control Markets that will form the basis of the Semantic Layer. The semantic layer aims to provide a unified, business-oriented view of the data, abstracting the underlying database schemas.

## 1. Core Organizational Entities

### Organization (`IOrganization`)
The top-level container for all data and settings.
- **Fields**: `id`, `name`, `description`, `type`, `socialNetworks` (list of accounts).
- **Role**: Multi-tenant context.

### Human Resource (`IHumanResource`)
Represents people and their professional context within an organization.
- **Fields**: `name`, `role`, `status` (Active, Inactive, etc.), `contractType`, `skills`, `payment` (Config for amount, currency, frequency).
- **Role**: Workforce management and task assignment targets.

---

## 2. CRM & Marketing Entities

### Lead (`ILead`)
Potential clients or interaction targets.
- **Fields**: `fullName`, `phoneNumber`, `description`, `messages` (Chat history), `conversationAnalysis`.
- **Role**: Sales pipeline and communication tracking.

### Inspiration Source (`IInspirationSource`)
External content used for creative reference.
- **Fields**: `title`, `type` (Account, Content, Idea), `platform` (TikTok, IG, YT), `url`, `monitoring` (Frequency, last check), `tags`.
- **Role**: Content discovery and creative input.

### Social Media Tracker (`ISocialMediaTracker`)
Operational entity for tracking published or planned content.
- **Fields**: `name`, `platform`, `status` (Draft, Scheduled, Published), `scheduledDate`, `breakdown` (AI analysis/summary), `videoUrl`.
- **Role**: Content performance and scheduling.

---

## 3. Automation & AI Entities

### Agent Task (`IAgentTask`)
The definition of an actionable unit, either for an AI Agent or a Human.
- **Fields**: `name`, `taskType` (Review, Create, Human), `prompt`, `userPrompt`, `assignedTo` (Agent or User), `settings` (Model config, sources).
- **Role**: Work orchestration.

### Agent Outcome Job (`IAgentOutcomeJob`)
The execution record and result of an Agent Task.
- **Fields**: `messages` (Input context), `response` (AI raw response), `result` (Structured output), `sources` (Reference data used).
- **Role**: Execution audit and result storage.

### Agent Source (`IAgentSource`)
Contextual data extracted from external platforms.
- **Fields**: `name`, `content`, `type` (Youtube, Notion, Website), `sourceUrl`, `transcription`, `description`.
- **Role**: Knowledge base for AI agents.

---

## 4. Content Production Entities

### Video Project (`IVideoProjectGenerator`)
A high-level generator for complex video content.
- **Fields**: `brief` (Concept, tone, duration), `scenes` (Dialog, prompts, visual refs), `assets` (Audios, images, videos used), `compositionPlan`.
- **Role**: End-to-end content generation.

### Creative Flowboard (`ICreativeFlowboard`)
A visual automation blueprint.
- **Fields**: `nodes` (Task, Agent, Source components), `edges` (Logic connections).
- **Role**: Workflow visual programming.

---

## 5. Relationships & Semantic Mapping

| Entity A | Relationship | Entity B | Context |
| :--- | :--- | :--- | :--- |
| **Organization** | Has Many | **Human Resource** | Team members |
| **Organization** | Has Many | **Lead** | Sales database |
| **Agent Task** | Produces | **Agent Outcome Job** | Execution history |
| **Flowboard** | Orchestrates | **Agent Task** | Automation logic |
| **Inspiration** | Relates to | **Generated Asset** | Creative derivation |
| **Video Project** | Uses | **Agent Source** | Content context |

## Proposed Semantic Model Structure

For the AI to interact with these objects, we should expose them through a unified interface where each "Resource Type" is clearly mapped to its corresponding collection and search capabilities.

```typescript
export const SemanticResourceMap = {
  organization: 'organizations',
  hr: 'human_resources',
  lead: 'leads',
  inspiration: 'inspiration_sources',
  tracker: 'social_media_trackers',
  task: 'agent_tasks',
  outcome: 'agent_outcome_jobs',
  video_project: 'video_projects',
  flow: 'creative_flowboards',
  source: 'agent_sources'
};
```
