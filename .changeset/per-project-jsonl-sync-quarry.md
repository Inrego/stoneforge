---
"@stoneforge/quarry": minor
---

Route JSONL sync per registered project. `SyncService.export`/`import` accept an optional `projectId` that restricts elements, scopes dependencies (via the `blocked` side), and — on incremental export — clears only that project's dirty markers. `AutoExportService` takes a matching `projectId` so multiple streams can coexist on one backend. A new `ProjectSyncCoordinator` spawns one `AutoExportService` per entry in the projects registry, writing each project's JSONL to `{project.path}/.stoneforge/` so each project's data travels with its own git tree. When no projects are registered the classic single-stream behavior is preserved.
