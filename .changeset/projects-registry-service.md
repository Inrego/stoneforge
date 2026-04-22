---
'@stoneforge/quarry': minor
---

Add projects registry service backed by `~/.stoneforge/projects.json`. Exposes
`createProjectRegistryService` with CRUD operations (create/get/list/update/
remove/reload) and `validateProjectPath` that checks the target directory is a
git repository (supports worktree `.git` pointer files). The quarry server
reads the registry on boot and surfaces it as `QuarryApp.projectsService`;
failures degrade gracefully without blocking server startup. (el-56c)
