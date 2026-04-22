---
'@stoneforge/smithy': minor
---

Launch agents in the owning project's working directory. The dispatch daemon
and worker task service now resolve `task.projectId` to a `Project` element
and pass `project.path` to the worktree manager as a new `projectRoot`
override, so worktrees land under `{project.path}/.stoneforge/.worktrees/...`
instead of always under the host workspace root. A shared
`resolveTaskProjectRoot` helper centralises the lookup; missing/invalid
`projectId` is non-fatal and transparently falls back to the workspace-root
behaviour, preserving single-project workspaces. (el-5hh)
