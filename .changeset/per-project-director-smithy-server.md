---
"@stoneforge/smithy-server": minor
---

Director agent registration endpoint validates `projectId` as a required non-empty string and forwards it to the orchestrator API so new directors are persisted with their owning project id. (el-yxi)
