---
"@stoneforge/quarry": minor
---

Add progress bar to `link-all` and `push --all` commands. The progress bar displays on stderr in interactive TTY sessions and is suppressed in `--json`, `--quiet`, and non-TTY (piped/CI) modes.
