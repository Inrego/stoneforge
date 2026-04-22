---
'@stoneforge/smithy': minor
---

Agents now carry an optional `projectFilter: ProjectId[]` scope, and the
dispatch daemon honours it when routing ready tasks. Agents with an empty or
undefined filter stay **global** (match every task); agents with a non-empty
filter only pick up tasks whose `projectId` is in the list, and tasks without
a `projectId` (workspace-scoped) are routed only to global agents.

Applies across worker-availability dispatch and steward workflow-task
dispatch, and is exposed via a new `sf agent register --projectFilter
<ids>` CLI option. (el-2ao)
