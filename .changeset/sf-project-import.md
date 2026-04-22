---
'@stoneforge/quarry': minor
---

Add `sf project import [path]` and `sf project list` CLI commands for
adopting existing workspaces into the global projects registry. `import`
validates the target is a git repository, registers (or renames) it in
`~/.stoneforge/projects.json`, and rebuilds the global SQLite cache at
`~/.stoneforge/stoneforge.db` from every registered project's JSONL
source-of-truth. The cache is disposable and is rebuilt from scratch on
every import, so it cannot drift from the on-disk JSONL.

Also adds `STONEFORGE_HOME` as an environment-variable override for the
global `~/.stoneforge` directory, and exposes the `getGlobalDbPath` and
`rebuildGlobalCache` helpers from the `projects` sub-module. (el-26x)
