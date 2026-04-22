---
"@stoneforge/quarry": minor
---

Promote projectId to a dedicated `project_id` column in serialize/deserialize so every element response carries its project association. ElementFilter gains an optional `projectId` that defaults to spanning all projects; pass a ProjectId to narrow, or `null` to list only unassigned rows.
