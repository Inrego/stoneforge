---
"@stoneforge/smithy": minor
---

Per-project metrics dimension. `RecordMetricInput` gains an optional `projectId`; the metrics service now persists it, exposes a new `aggregateByProject()` (with "unassigned" sentinel for NULL project_id), and accepts an optional `{ projectId }` filter on `aggregateByProvider`, `aggregateByModel`, `aggregateByAgent`, and `getTimeSeries`. `GET /api/provider-metrics` accepts `projectId=<id>` / `projectId=unassigned` to scope aggregation, and `groupBy=project` for the cross-project totals view. Session metric upserts now resolve and attach the owning project from the assigned task.
