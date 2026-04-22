---
"@stoneforge/smithy": minor
---

Per-project Director registration. `RegisterDirectorInput` and `DirectorMetadata` gain a required `projectId`, and `validateAgentMetadata` enforces a non-empty string for directors. The orchestrator API, CLI (`sf agent register --project`), and HTTP routes validate the new field on director creation. Worker/steward registration is unchanged. `AgentFilter` gains an optional `projectId` so `listAgents({ role: 'director', projectId })` powers cross-project director queries. (el-yxi)
