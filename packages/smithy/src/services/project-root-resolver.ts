/**
 * Project Root Resolver
 *
 * Resolves the owning project's filesystem path from a task's `projectId`.
 *
 * Used by the dispatch daemon and the worker task service to decide where
 * to place a task's git worktree in a multi-project workspace. The lookup
 * is intentionally non-fatal: missing/invalid `projectId` falls back to
 * the caller's workspace-root behaviour so existing single-project flows
 * keep working.
 *
 * @module
 */

import type { Task, Project } from '@stoneforge/core';
import type { QuarryAPI } from '@stoneforge/quarry';

/**
 * Minimal logger surface we rely on here — matches what both
 * `dispatch-daemon` and `worker-task-service` pass in, without pulling
 * their concrete logger implementation into this module.
 */
export interface ProjectRootLogger {
  warn(message: string, ...rest: unknown[]): void;
}

/**
 * Resolves `task.projectId` → `project.path`.
 *
 * Returns `undefined` when:
 *  - the task has no `projectId`,
 *  - the referenced project element cannot be fetched,
 *  - the fetch throws for any reason.
 *
 * All failures are logged at warn level; callers fall back to their
 * default (e.g. `config.workspaceRoot`) when `undefined` is returned.
 */
export async function resolveTaskProjectRoot(
  api: QuarryAPI,
  task: Task,
  logger: ProjectRootLogger
): Promise<string | undefined> {
  const projectId = task.projectId;
  if (!projectId) {
    return undefined;
  }
  try {
    const project = await api.get<Project>(projectId);
    if (!project || !project.path) {
      logger.warn(
        `Task ${task.id} references projectId ${projectId} but no project record (or no path) was found; falling back to workspace root`
      );
      return undefined;
    }
    return project.path;
  } catch (error) {
    logger.warn(
      `Failed to resolve project root for task ${task.id} (projectId=${projectId}); falling back to workspace root:`,
      error
    );
    return undefined;
  }
}
