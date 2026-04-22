---
'@stoneforge/smithy': minor
---

Move the smithy server SQLite database to a global per-user location.
`DB_PATH` now defaults to `~/.stoneforge/stoneforge.db` (overridable via the
`STONEFORGE_DB_PATH` environment variable) so a single database is shared
across every Stoneforge workspace on the machine, enabling multi-project
orchestration. `packages/smithy/src/server/config.ts` no longer calls
`process.cwd()`; workspace-scoped paths are captured separately in the new
`packages/smithy/src/server/paths.ts` module, preserving existing behavior
for asset uploads, workspace file browsing, and daemon-state persistence.
(el-3zm)
