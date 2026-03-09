---
"@stoneforge/smithy": patch
---

Fix headless session termination: close() now interrupts the underlying SDK query/process to prevent zombie agents from continuing after stop
