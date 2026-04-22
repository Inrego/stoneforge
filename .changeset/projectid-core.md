---
"@stoneforge/core": minor
---

Move ProjectId branded type + validation helpers into element.ts so the base Element interface can carry an optional projectId field without a circular import. project.ts re-exports the surface for backward compatibility.
