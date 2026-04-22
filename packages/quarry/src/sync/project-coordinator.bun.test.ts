/**
 * ProjectSyncCoordinator Tests
 *
 * Verifies lifecycle behavior (start/stop/reload) and routing correctness
 * for per-project JSONL sync.
 */

import { describe, expect, test, beforeEach, afterEach } from 'bun:test';
import { mkdtempSync, rmSync, existsSync, readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createStorage, initializeSchema } from '@stoneforge/storage';
import type { StorageBackend } from '@stoneforge/storage';
import type { Element, ElementId, EntityId } from '@stoneforge/core';
import { ElementType, createTimestamp } from '@stoneforge/core';
import { createSyncService } from './service.js';
import type { SyncConfig } from '../config/types.js';
import {
  createProjectSyncCoordinator,
  PROJECT_SYNC_DIRNAME,
  ProjectSyncCoordinator,
} from './project-coordinator.js';
import type { ProjectRegistryService } from '../projects/service.js';
import type { Project } from '../projects/registry.js';

// ============================================================================
// Helpers
// ============================================================================

function createTempDir(): string {
  return mkdtempSync(join(tmpdir(), 'stoneforge-project-sync-'));
}

function createTestBackend(path: string): StorageBackend {
  const b = createStorage({ path });
  initializeSchema(b);
  return b;
}

/**
 * rmSync with a short retry loop to cope with Windows + bun:sqlite WAL
 * release timing. Swallows the final error — temp dirs are under /tmp.
 */
function tryRmSync(dir: string): void {
  if (!existsSync(dir)) return;
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      rmSync(dir, { recursive: true, force: true });
      return;
    } catch {
      const until = Date.now() + 50;
      while (Date.now() < until) {
        /* spin */
      }
    }
  }
}

function defaultSyncConfig(overrides: Partial<SyncConfig> = {}): SyncConfig {
  return {
    autoExport: true,
    exportDebounce: 50,
    elementsFile: 'elements.jsonl',
    dependenciesFile: 'dependencies.jsonl',
    ...overrides,
  };
}

function insertScoped(backend: StorageBackend, id: string, projectId: string | null): void {
  const el: Element = {
    id: id as ElementId,
    type: ElementType.TASK,
    createdAt: createTimestamp(),
    updatedAt: createTimestamp(),
    createdBy: 'el-sys' as EntityId,
    tags: [],
    metadata: {},
  } as Element;
  const { id: _id, type, createdAt, updatedAt, createdBy, tags: _tags, ...data } = el;
  backend.run(
    `INSERT INTO elements (id, type, data, created_at, updated_at, created_by, project_id)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [id, type, JSON.stringify(data), createdAt, updatedAt, createdBy, projectId]
  );
}

/** Build an in-memory stand-in for ProjectRegistryService. */
function makeRegistry(projects: Project[]): ProjectRegistryService {
  let current = [...projects];
  return {
    path: '/fake/registry.json',
    create: () => {
      throw new Error('not used in these tests');
    },
    get: (id) => current.find((p) => p.id === id),
    getByPath: () => undefined,
    list: () => [...current],
    update: () => {
      throw new Error('not used in these tests');
    },
    remove: (id) => {
      const before = current.length;
      current = current.filter((p) => p.id !== id);
      return current.length !== before;
    },
    reload: () => {
      /* no-op */
    },
    snapshot: () => ({ version: 1, projects: [...current] }),
    // Testing hook: mutate the in-memory project list.
    // @ts-expect-error — test-only extension
    _replace(next: Project[]) {
      current = [...next];
    },
  } as ProjectRegistryService & { _replace: (next: Project[]) => void };
}

function projectAt(tmpRoot: string, id: string, name: string): Project {
  const p = join(tmpRoot, id);
  mkdirSync(p, { recursive: true });
  // Touch a .git marker so the (unused here) validator would be happy.
  writeFileSync(join(p, '.git'), 'gitdir: /fake');
  return {
    id,
    name,
    path: p,
    registeredAt: new Date().toISOString(),
  };
}

// ============================================================================
// Tests
// ============================================================================

describe('ProjectSyncCoordinator', () => {
  let tempDir: string;
  let backend: StorageBackend;

  beforeEach(() => {
    tempDir = createTempDir();
    // :memory: backend — the JSONL output goes to real directories (per
    // project) inside `tempDir`, but the SQLite cache doesn't need a file
    // and an in-memory backend closes instantly without WAL races.
    backend = createTestBackend(':memory:');
  });

  afterEach(() => {
    if (backend.isOpen) backend.close();
    tryRmSync(tempDir);
  });

  test('starts one stream per registered project, routing to {path}/.stoneforge', async () => {
    const projectA = projectAt(tempDir, 'el-pa', 'alpha');
    const projectB = projectAt(tempDir, 'el-pb', 'beta');

    insertScoped(backend, 'el-task-a', 'el-pa');
    insertScoped(backend, 'el-task-b', 'el-pb');

    const syncService = createSyncService(backend);
    const registry = makeRegistry([projectA, projectB]);

    const coordinator = createProjectSyncCoordinator({
      syncService,
      backend,
      syncConfig: defaultSyncConfig(),
      projectsService: registry,
    });

    await coordinator.start();

    // Each project gets its own JSONL in its own .stoneforge/
    const fileA = join(projectA.path, PROJECT_SYNC_DIRNAME, 'elements.jsonl');
    const fileB = join(projectB.path, PROJECT_SYNC_DIRNAME, 'elements.jsonl');
    expect(existsSync(fileA)).toBe(true);
    expect(existsSync(fileB)).toBe(true);

    const contentA = readFileSync(fileA, 'utf-8');
    const contentB = readFileSync(fileB, 'utf-8');

    expect(contentA).toContain('el-task-a');
    expect(contentA).not.toContain('el-task-b');
    expect(contentB).toContain('el-task-b');
    expect(contentB).not.toContain('el-task-a');

    coordinator.stop();
  });

  test('start() is idempotent', async () => {
    const project = projectAt(tempDir, 'el-pi', 'idemp');
    const registry = makeRegistry([project]);
    const coordinator = createProjectSyncCoordinator({
      syncService: createSyncService(backend),
      backend,
      syncConfig: defaultSyncConfig(),
      projectsService: registry,
    });

    await coordinator.start();
    await coordinator.start();

    expect(coordinator.getActiveProjectIds()).toEqual(['el-pi']);
    coordinator.stop();
  });

  test('reload() adds streams for new projects and stops removed ones', async () => {
    const projectA = projectAt(tempDir, 'el-pa', 'alpha');
    const projectB = projectAt(tempDir, 'el-pb', 'beta');

    const registry = makeRegistry([projectA]) as ProjectRegistryService & {
      _replace: (next: Project[]) => void;
    };
    const coordinator = createProjectSyncCoordinator({
      syncService: createSyncService(backend),
      backend,
      syncConfig: defaultSyncConfig(),
      projectsService: registry,
    });

    await coordinator.start();
    expect(coordinator.getActiveProjectIds()).toEqual(['el-pa']);

    // Registry now contains B (and drops A).
    registry._replace([projectB]);
    await coordinator.reload();

    expect(coordinator.getActiveProjectIds()).toEqual(['el-pb']);
    coordinator.stop();
  });

  test('stop() halts every stream and resets state', async () => {
    const project = projectAt(tempDir, 'el-ps', 'stopme');
    const coordinator = createProjectSyncCoordinator({
      syncService: createSyncService(backend),
      backend,
      syncConfig: defaultSyncConfig(),
      projectsService: makeRegistry([project]),
    });

    await coordinator.start();
    expect(coordinator.getActiveProjectIds()).toHaveLength(1);

    coordinator.stop();
    expect(coordinator.getActiveProjectIds()).toHaveLength(0);
  });

  test('outputDirFor joins {project.path}/.stoneforge', () => {
    expect(
      ProjectSyncCoordinator.outputDirFor({ path: '/abs/path/myproj' })
    ).toBe(join('/abs/path/myproj', PROJECT_SYNC_DIRNAME));
  });
});
