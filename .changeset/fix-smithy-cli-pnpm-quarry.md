---
'@stoneforge/quarry': patch
---

Check for pre-registered CLI plugins on globalThis before attempting dynamic import, fixing plugin discovery under pnpm strict module isolation.
