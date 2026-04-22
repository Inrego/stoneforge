---
"@stoneforge/storage": minor
---

Add migration 14: nullable `project_id` column + composite `(project_id, timestamp)` index on the `provider_metrics` table so provider metrics can be attributed to a specific project and aggregated per-project efficiently.
