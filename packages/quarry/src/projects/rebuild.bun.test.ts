/**
 * Tests for the global-cache rebuild pipeline.
 *
 * The pipeline is exercised end-to-end against a real storage backend and
 * real JSONL files written to temp dirs: it is the only way to catch
 * regressions in the "wipe + re-import" sequence without re-implementing
 * the sync service.
 */

import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { createStorage, initializeSchema } from '@stoneforge/storage';
import { getGlobalDbPath, rebuildGlobalCache } from './rebuild.js';
import type { Project } from './registry.js';

// ============================================================================
// Test helpers
// ============================================================================

let sandbox: string;

beforeEach(() => {
  sandbox = mkdtempSync(join(tmpdir(), 'sf-rebuild-'));
});

afterEach(() => {
  tryRmSync(sandbox);
});

/** rmSync with a retry loop, for Windows + bun:sqlite lock-release delays. */
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

/** Create a directory that looks like a git repo with a `.stoneforge/sync/` dir. */
function makeProject(name: string, options?: { withSync?: boolean }): {
  project: Project;
  syncDir: string;
} {
  const root = join(sandbox, name);
  mkdirSync(join(root, '.git'), { recursive: true });
  const syncDir = join(root, '.stoneforge');
  if (options?.withSync !== false) {
    mkdirSync(syncDir, { recursive: true });
  }
  return {
    project: {
      id: `proj-${name.padEnd(8, '0').slice(0, 8)}`,
      name,
      path: root,
      registeredAt: '2026-04-22T00:00:00.000Z',
    },
    syncDir,
  };
}

/** Write a minimal elements.jsonl with a single task element. */
function writeTaskJsonl(syncDir: string, id: string, title: string): void {
  const line = JSON.stringify({
    id,
    type: 'task',
    createdAt: '2026-04-22T00:00:00.000Z',
    updatedAt: '2026-04-22T00:00:00.000Z',
    createdBy: 'user:test',
    tags: [],
    metadata: {},
    title,
    status: 'open',
    priority: 3,
    taskType: 'task',
  });
  writeFileSync(join(syncDir, 'elements.jsonl'), `${line}\n`, 'utf-8');
  writeFileSync(join(syncDir, 'dependencies.jsonl'), '', 'utf-8');
}

// ============================================================================
// getGlobalDbPath
// ============================================================================

describe('getGlobalDbPath', () => {
  test('points at ~/.stoneforge/stoneforge.db', () => {
    const p = getGlobalDbPath();
    expect(p.endsWith('stoneforge.db')).toBe(true);
    expect(p).toContain('.stoneforge');
  });
});

// ============================================================================
// rebuildGlobalCache
// ============================================================================

describe('rebuildGlobalCache', () => {
  test('creates an empty DB when there are no projects', () => {
    const dbPath = join(sandbox, 'global.db');
    const result = rebuildGlobalCache({ dbPath, projects: [] });

    expect(result.dbPath).toBe(dbPath);
    expect(result.projectsImported).toBe(0);
    expect(result.projectsSkipped).toBe(0);
    expect(result.totalElementsImported).toBe(0);
    expect(existsSync(dbPath)).toBe(true);
  });

  test('imports JSONL from every registered project', () => {
    const dbPath = join(sandbox, 'global.db');

    const a = makeProject('alpha');
    writeTaskJsonl(a.syncDir, 'el-alpha-1', 'Alpha task');

    const b = makeProject('betaxxxx');
    writeTaskJsonl(b.syncDir, 'el-beta-1', 'Beta task');

    const result = rebuildGlobalCache({
      dbPath,
      projects: [a.project, b.project],
    });

    expect(result.projectsImported).toBe(2);
    expect(result.projectsSkipped).toBe(0);
    expect(result.totalElementsImported).toBe(2);

    // Re-open and verify the elements landed with the right project_id.
    const backend = createStorage({ path: dbPath });
    try {
      initializeSchema(backend);
      const rows = backend.query<{ id: string; project_id: string | null }>(
        'SELECT id, project_id FROM elements ORDER BY id'
      );
      expect(rows.map((r) => r.id)).toEqual(['el-alpha-1', 'el-beta-1']);
      expect(rows.map((r) => r.project_id)).toEqual([a.project.id, b.project.id]);
    } finally {
      backend.close();
    }
  });

  test('skips projects whose path is missing or not a git repo', () => {
    const dbPath = join(sandbox, 'global.db');

    const good = makeProject('good');
    writeTaskJsonl(good.syncDir, 'el-good-1', 'Good task');

    const missing: Project = {
      id: 'proj-missing',
      name: 'missing',
      path: join(sandbox, 'does-not-exist'),
      registeredAt: '2026-04-22T00:00:00.000Z',
    };

    const result = rebuildGlobalCache({
      dbPath,
      projects: [good.project, missing],
    });

    expect(result.projectsImported).toBe(1);
    expect(result.projectsSkipped).toBe(1);
    expect(result.totalElementsImported).toBe(1);
    expect(result.skipped).toHaveLength(1);
    expect(result.skipped[0].id).toBe('proj-missing');
    expect(result.skipped[0].reason).toMatch(/does not exist|Not a git repository/i);
  });

  test('skips projects with no .stoneforge/ sync directory yet', () => {
    const dbPath = join(sandbox, 'global.db');
    // Valid git repo, but no sync dir — e.g., a freshly-adopted workspace
    // that hasn't produced JSONL yet.
    const bare = makeProject('bareonly', { withSync: false });

    const result = rebuildGlobalCache({ dbPath, projects: [bare.project] });

    expect(result.projectsImported).toBe(0);
    expect(result.projectsSkipped).toBe(1);
    expect(result.skipped[0].reason).toMatch(/Missing sync directory/);
  });

  test('is idempotent — running twice yields the same element set', () => {
    const dbPath = join(sandbox, 'global.db');
    const a = makeProject('alpha');
    writeTaskJsonl(a.syncDir, 'el-alpha-1', 'Alpha task');

    rebuildGlobalCache({ dbPath, projects: [a.project] });
    const second = rebuildGlobalCache({ dbPath, projects: [a.project] });

    expect(second.projectsImported).toBe(1);
    expect(second.totalElementsImported).toBe(1);

    const backend = createStorage({ path: dbPath });
    try {
      const rows = backend.query<{ id: string }>('SELECT id FROM elements');
      expect(rows).toHaveLength(1);
    } finally {
      backend.close();
    }
  });

  test('drops stale entries — removed projects vanish from the cache', () => {
    const dbPath = join(sandbox, 'global.db');
    const a = makeProject('alpha');
    writeTaskJsonl(a.syncDir, 'el-alpha-1', 'Alpha task');
    const b = makeProject('betaxxxx');
    writeTaskJsonl(b.syncDir, 'el-beta-1', 'Beta task');

    rebuildGlobalCache({ dbPath, projects: [a.project, b.project] });
    // Rebuild without beta — its rows should be gone.
    rebuildGlobalCache({ dbPath, projects: [a.project] });

    const backend = createStorage({ path: dbPath });
    try {
      const rows = backend.query<{ id: string }>('SELECT id FROM elements');
      expect(rows.map((r) => r.id)).toEqual(['el-alpha-1']);
    } finally {
      backend.close();
    }
  });
});
