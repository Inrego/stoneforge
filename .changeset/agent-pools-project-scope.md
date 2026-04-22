---
'@stoneforge/smithy': minor
---

Agent pools now have an optional `projectId` scope. A pool with no `projectId`
is a **global** concurrency ceiling enforced for every spawn; a pool with a
`projectId` is a **per-project override** layered on top and only applies to
spawns whose task `projectId` matches.

`canSpawn` evaluates global pools before per-project pools, so the workspace
ceiling is always respected first and an over-capacity global pool surfaces
in the rejection reason. The dispatch daemon now forwards `task.projectId`
into every `PoolSpawnRequest` and `onAgentSpawned` call, and the pool service
tracks each agent's project so per-project counters stay balanced when
sessions end.

Exposed via `sf pool create --project <id>` / `sf pool list --project
<scope>` (or `global`) and a `projectId` field on the `POST /api/pools`
body and `project` query param on `GET /api/pools`. (el-u1k)
