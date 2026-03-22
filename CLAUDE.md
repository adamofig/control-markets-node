# Claude Instructions for control-markets-node

## Project Overview

**Control Markets** is a modular platform for orchestrating AI-powered creative and marketing workflows. It is built on **NestJS (Fastify)** with **MongoDB** as the primary database, and integrates multiple AI providers (OpenAI, Google Vertex AI, Anthropic, ComfyUI).

The platform enables users to design **agentic workflows** through a visual node-based flowboard, where AI agents with distinct personas execute tasks like content generation, social media scheduling, and video creation.

Full business context: [`docs/business/understanding-control-markets.md`](docs/business/understanding-control-markets.md)
Full technical index: [`docs/index.md`](docs/index.md)

---

## Key Source Locations

| Area | Path |
| :--- | :--- |
| App root module | `src/app.module.ts` |
| All feature modules | `src/` (one folder per module) |
| Documentation index | `docs/index.md` |
| Business overview | `docs/business/understanding-control-markets.md` |
| Technical reference | `docs/technical-reference/` |
| Technical guides | `docs/technical-guides/` |
| API collections (Bruno) | `docs/bruno-docs/` |
| Plans & roadmap | `docs/plans/` |
| Claude skills | `.claude/skills/` |

---

## Architecture Summary

- **Framework**: NestJS with Fastify
- **Database**: MongoDB via Mongoose (`@dataclouder/nest-mongo`)
- **Auth**: Firebase + JWT (`@dataclouder/nest-auth`)
- **AI**: Google Vertex AI, OpenAI, Anthropic, ComfyUI
- **Real-time**: SSE (Server-Sent Events)
- **Pattern**: Entity Scaffold — every feature follows the same module/service/controller/schema structure

### Core MongoDB Collections

| Collection | Purpose |
| :--- | :--- |
| `organizations` | Root multi-tenant entity |
| `users` | User profiles and auth metadata |
| `social_media_tracker` | Social post scheduling and status |
| `agent_flows` | Visual flowboard definitions |
| `flow_execution_states` | Real-time execution tracking |
| `agent_cards` | Agent persona definitions |
| `agent_tasks` | Tasks assigned to agents in a flow |
| `agent_outcome_jobs` | Execution history and AI output |
| `agent_sources` | Knowledge sources (URLs, docs, YouTube) |
| `generated_assets` | AI-generated file registry |
| `storage_assets` | All uploaded/generated file metadata |
| `video_projects` | Video-centric creative projects |
| `serp_trends_by_day` | Daily SERP trend monitoring |

---

## Entity Scaffold

When the user asks to create a new entity, module, collection, or NestJS resource, invoke the `/entity-scaffold` skill defined in [`.claude/skills/entity-scaffold/SKILL.md`](.claude/skills/entity-scaffold/SKILL.md).
