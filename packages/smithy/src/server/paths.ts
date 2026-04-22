/**
 * Server Path Resolution
 *
 * Captures workspace-scoped paths that depend on where the server was
 * launched from. Kept separate from `config.ts` because the server DB now
 * lives in a global per-user directory (`~/.stoneforge/`) and no longer
 * depends on `process.cwd()` — only workspace-local features (asset uploads,
 * workspace file browsing, daemon state) do.
 */

/**
 * Absolute path to the workspace root the server is operating on.
 *
 * Captured once at module load from `process.cwd()` so every consumer sees
 * a consistent value regardless of later `chdir` calls. Callers that need
 * to target a different workspace (e.g., tests, multi-project orchestration)
 * should plumb an explicit path through their own options rather than
 * overriding this constant.
 */
export const PROJECT_ROOT: string = process.cwd();
