---
"@stoneforge/smithy": patch
---

Cap parsed rate limit reset times to 24 hours maximum and prevent setTimeout overflow by clamping delay values to the 32-bit signed integer max
