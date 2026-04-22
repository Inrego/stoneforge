---
"@stoneforge/smithy": patch
---

Wire `poolService.onAgentSessionEnded` into the session lifecycle so agent pool slots are released when sessions end. Previously the method was defined but never called from production (only `onAgentSpawned` was wired in dispatch-daemon), causing the in-memory `statusCache` and `agentProjects` map to grow unbounded between `refreshAllPoolStatus` runs. The notification now fires from both `onResultEvent` (graceful completion path) and `onExit` (crash/kill path) with an idempotency guard, so the pool's `activeCount` is never double-decremented.
