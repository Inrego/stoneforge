---
'@stoneforge/smithy': patch
---

Pre-register the CLI plugin on globalThis so quarry can discover it without dynamic import under pnpm strict isolation.
