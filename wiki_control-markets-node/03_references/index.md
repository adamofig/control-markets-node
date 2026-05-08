# 03 — References

Source-of-truth technical documentation. Describes exactly how each module works — API contracts, environment variables, file structures, and edge cases.

## Files

- [architecture.md](architecture.md) — High-level overview of the backend tech stack (NestJS, Fastify, MongoDB) and service layers.
- [ai-services-comunication.md](ai-services-comunication.md) — How the backend requests and coordinates generative tasks with AI Services using Asset IDs.
- [social-post-tracker.md](social-post-tracker.md) — Schema and API reference for the content planning module — scheduling fields, MongoDB collection, and CRUD endpoints.
- [social-media-tracker-implementation.md](social-media-tracker-implementation.md) — Implementation details and service logic for the social media tracker.
- [social-media-tracker-plan-relation.md](social-media-tracker-plan-relation.md) — Relationship between the social media tracker and broader content planning strategy.
- [mcp-server.md](mcp-server.md) — How the platform is exposed as an MCP server — available tools, endpoint URLs, and how to register it in Claude Code.
- [organizations.md](organizations.md) — Multi-tenant organization model, schema, and related API.
- [human-resources.md](human-resources.md) — HR collaborator tracking module — schema, payment config, API endpoints, and AI agent integration guide.
- [docker-config.md](docker-config.md) — Docker configuration and deployment setup for the Node backend.
- [resources-semantic-layer.md](resources-semantic-layer.md) — Semantic layer for resource modeling across the platform.
- [storage-files-full-metadata.md](storage-files-full-metadata.md) — Full metadata spec for uploaded and generated files in storage assets.

## Sub-folders

- [flowboard/](flowboard/index.md) — Deep-dive references for the Flow execution engine, node processors, and real-time sync.
