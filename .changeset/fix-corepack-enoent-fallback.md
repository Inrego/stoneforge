---
"@stoneforge/smithy": patch
---

Fix corepack ENOENT fallback in worktree dependency installation. When corepack is detected as available but fails with ENOENT at spawn time, the install now falls back to direct package manager invocation instead of failing fatally on both retry attempts.
