/**
 * Unit tests for the shared project-root resolver used by the dispatch
 * daemon and the worker task service.
 */

import { describe, test, expect, mock } from 'bun:test';
import type { Task } from '@stoneforge/core';
import type { QuarryAPI } from '@stoneforge/quarry';

import {
  resolveTaskProjectRoot,
  type ProjectRootLogger,
} from './project-root-resolver.js';

function makeLogger(): ProjectRootLogger & { warnings: unknown[][] } {
  const warnings: unknown[][] = [];
  return {
    warnings,
    warn: (message: string, ...rest: unknown[]) => {
      warnings.push([message, ...rest]);
    },
  };
}

function makeApi(get: (id: string) => Promise<unknown>): QuarryAPI {
  return { get: mock(get) } as unknown as QuarryAPI;
}

function makeTask(projectId?: string): Task {
  return {
    id: 'el-task1',
    type: 'task',
    title: 'Test',
    status: 'open',
    ...(projectId ? { projectId } : {}),
  } as unknown as Task;
}

describe('resolveTaskProjectRoot', () => {
  test('returns undefined when task has no projectId', async () => {
    const api = makeApi(async () => null);
    const logger = makeLogger();

    const result = await resolveTaskProjectRoot(api, makeTask(), logger);

    expect(result).toBeUndefined();
    expect(logger.warnings.length).toBe(0);
  });

  test('returns project.path when project element is resolvable', async () => {
    const api = makeApi(async () => ({
      id: 'el-proj1',
      type: 'project',
      name: 'svc-a',
      path: '/abs/path/to/project',
    }));
    const logger = makeLogger();

    const result = await resolveTaskProjectRoot(api, makeTask('el-proj1'), logger);

    expect(result).toBe('/abs/path/to/project');
    expect(logger.warnings.length).toBe(0);
  });

  test('returns undefined and logs a warning when project is missing', async () => {
    const api = makeApi(async () => null);
    const logger = makeLogger();

    const result = await resolveTaskProjectRoot(api, makeTask('el-ghost'), logger);

    expect(result).toBeUndefined();
    expect(logger.warnings.length).toBe(1);
    expect(String(logger.warnings[0][0])).toContain('el-ghost');
  });

  test('returns undefined and logs a warning when the fetch throws', async () => {
    const api = makeApi(async () => {
      throw new Error('db offline');
    });
    const logger = makeLogger();

    const result = await resolveTaskProjectRoot(api, makeTask('el-proj1'), logger);

    expect(result).toBeUndefined();
    expect(logger.warnings.length).toBe(1);
    expect(String(logger.warnings[0][0])).toContain('el-proj1');
  });

  test('treats a project with empty path as unresolvable', async () => {
    const api = makeApi(async () => ({
      id: 'el-proj1',
      type: 'project',
      name: 'svc-a',
      path: '',
    }));
    const logger = makeLogger();

    const result = await resolveTaskProjectRoot(api, makeTask('el-proj1'), logger);

    expect(result).toBeUndefined();
    expect(logger.warnings.length).toBe(1);
  });
});
