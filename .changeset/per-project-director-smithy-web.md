---
"@stoneforge/smithy-web": minor
---

Director Panel cross-project picker. A new `DirectorPicker` popover in the Director Panel header lists every registered director grouped by `projectId`, with unread badges and active-session indicators; selecting an entry switches the active tab and opens that director's interactive session. Legacy directors without a `projectId` fall under an `(unassigned)` group so operators can still see them. The Create Agent dialog now requires and validates `projectId` when creating a director. (el-yxi)
