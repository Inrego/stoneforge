---
"@stoneforge/storage": minor
---

Add `projectId` option to `DirtyTrackingOptions` so `getDirtyElements()` can be scoped to a single project. The storage layer now exports `buildDirtyElementsQuery` as the shared SQL builder used by Bun, Node, and Browser backends.
