---
"@stoneforge/shared-routes": minor
---

Thread projectId through API routes. Create/mutate routes (channels, documents, plans, libraries, tasks bulk) accept an optional `projectId` in the body to scope newly-created elements to a project (or detach on update). List routes (channels, documents, entities, elements, libraries, plans, message search) accept `?projectId=<id>` to narrow, `?projectId=null` for unassigned only, and span all projects when omitted. Messages inherit their channel's project scope.
