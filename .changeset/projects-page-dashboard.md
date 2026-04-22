---
'@stoneforge/smithy': minor
---

Add `/api/projects` HTTP endpoints to the Smithy orchestrator server, backing
the new Projects page in the web dashboard. The routes wrap the shared
`@stoneforge/quarry` projects registry service (`~/.stoneforge/projects.json`)
with CRUD operations: `GET /api/projects` lists registered workspaces, `POST`
registers a new one (name + filesystem path validated against `.git`),
`PATCH /api/projects/:id` renames, and `DELETE /api/projects/:id` unregisters.
Registry load failures (malformed JSON / unsupported version) no longer
block server startup — the endpoints return 503 so the UI can surface the
error instead. (el-65c)
