---
"@stoneforge/quarry": minor
---

`sf init` seeds the default director with `projectId: 'proj-local'` so the bootstrap flow continues to work under the per-project director registration rule. The sentinel is intentional until `sf project import` (el-26x) re-lands and auto-adopts single-project workspaces into the projects registry. (el-yxi)
