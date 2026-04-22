/**
 * Global DB rebuild tests
 */

import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createStorage } from '@stoneforge/storage';
import { rebuildGlobalCache } from './rebuild.js';
import type { ProjectRegistryEntry } from './registry.js';

function makeProject(
  root: string,
  opts: { entityId: string; entityName: string; taskId?: string; taskTitle?: string }
): string {
  const stoneforge = join(root, '.stoneforge');
  const sync = join(stoneforge, 'sync');
  mkdirSync(sync, { recursive: true });

  const lines: string[] = [];
  lines.push(
    JSON.stringify({
      id: opts.entityId,
      type: 'entity',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
      createdBy: opts.entityId,
      tags: [],
      metadata: {},
      name: opts.entityName,
      entityType: 'human',
    })
  );
  if (opts.taskId && opts.taskTitle) {
    lines.push(
      JSON.stringify({
        id: opts.taskId,
        type: 'task',
        createdAt: '2026-01-02T00:00:00.000Z',
        updatedAt: '2026-01-02T00:00:00.000Z',
        createdBy: opts.entityId,
        tags: [],
        metadata: {},
        title: opts.taskTitle,
        status: 'open',
        priority: 3,
        taskType: 'task',
      })
    );
  }

  writeFileSync(join(sync, 'elements.jsonl'), lines.join('\n') + '\n');
  writeFileSync(join(sync, 'dependencies.jsonl'), '');
  return root;
}

describe('projects/rebuild', () => {
  let tempDir: string;
  let dbPath: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'sf-rebuild-test-'));
    dbPath = join(tempDir, 'global.db');
  });

  afterEach(() => {
    try {
      rmSync(tempDir, { recursive: true, force: true });
    } catch {
      // ignore
    }
  });

  it('creates an empty DB with initialized schema for an empty registry', () => {
    const result = rebuildGlobalCache({ dbPath, projects: [] });
    expect(existsSync(dbPath)).toBe(true);
    expect(result.projectsImported).toBe(0);
    expect(result.projectsSkipped).toBe(0);
    expect(result.totalElementsImported).toBe(0);

    // Schema should be queryable
    const backend = createStorage({ path: dbPath, create: true });
    const rows = backend.query<{ id: string }>('SELECT id FROM elements');
    expect(rows).toEqual([]);
    backend.close();
  });

  it('imports elements from a single project', () => {
    const projRoot = join(tempDir, 'proj-a');
    makeProject(projRoot, {
      entityId: 'el-a001',
      entityName: 'alice',
      taskId: 'el-t100',
      taskTitle: 'first task',
    });

    const projects: ProjectRegistryEntry[] = [
      {
        id: 'proj-aaaa',
        name: 'a',
        path: projRoot,
        registeredAt: '2026-01-01T00:00:00.000Z',
      },
    ];
    const result = rebuildGlobalCache({ dbPath, projects });

    expect(result.projectsImported).toBe(1);
    expect(result.totalElementsImported).toBe(2);

    const backend = createStorage({ path: dbPath, create: true });
    const rows = backend.query<{ id: string }>('SELECT id FROM elements ORDER BY id');
    expect(rows.map((r) => r.id).sort()).toEqual(['el-a001', 'el-t100']);
    backend.close();
  });

  it('imports elements from multiple projects', () => {
    const a = makeProject(join(tempDir, 'a'), {
      entityId: 'el-a001',
      entityName: 'alice',
      taskId: 'el-t100',
      taskTitle: 'A task',
    });
    const b = makeProject(join(tempDir, 'b'), {
      entityId: 'el-b001',
      entityName: 'bob',
      taskId: 'el-t200',
      taskTitle: 'B task',
    });

    const result = rebuildGlobalCache({
      dbPath,
      projects: [
        { id: 'proj-a', name: 'a', path: a, registeredAt: '2026-01-01T00:00:00.000Z' },
        { id: 'proj-b', name: 'b', path: b, registeredAt: '2026-01-01T00:00:00.000Z' },
      ],
    });

    expect(result.projectsImported).toBe(2);
    expect(result.totalElementsImported).toBe(4);

    const backend = createStorage({ path: dbPath, create: true });
    const rows = backend.query<{ id: string }>('SELECT id FROM elements ORDER BY id');
    expect(rows.map((r) => r.id).sort()).toEqual(['el-a001', 'el-b001', 'el-t100', 'el-t200']);
    backend.close();
  });

  it('drops and rebuilds the DB on each call (idempotent)', () => {
    const projRoot = makeProject(join(tempDir, 'p'), {
      entityId: 'el-a001',
      entityName: 'alice',
      taskId: 'el-t100',
      taskTitle: 'first task',
    });
    const projects: ProjectRegistryEntry[] = [
      { id: 'proj-a', name: 'p', path: projRoot, registeredAt: '2026-01-01T00:00:00.000Z' },
    ];

    rebuildGlobalCache({ dbPath, projects });
    // Remove one element from the JSONL, then rebuild
    writeFileSync(
      join(projRoot, '.stoneforge', 'sync', 'elements.jsonl'),
      JSON.stringify({
        id: 'el-a001',
        type: 'entity',
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
        createdBy: 'el-a001',
        tags: [],
        metadata: {},
        name: 'alice',
        entityType: 'human',
      }) + '\n'
    );

    const result = rebuildGlobalCache({ dbPath, projects });
    expect(result.totalElementsImported).toBe(1);

    const backend = createStorage({ path: dbPath, create: true });
    const rows = backend.query<{ id: string }>('SELECT id FROM elements');
    expect(rows.map((r) => r.id)).toEqual(['el-a001']);
    backend.close();
  });

  it('skips projects whose path is missing and reports them', () => {
    const present = makeProject(join(tempDir, 'present'), {
      entityId: 'el-p001',
      entityName: 'pete',
    });

    const result = rebuildGlobalCache({
      dbPath,
      projects: [
        { id: 'proj-p', name: 'present', path: present, registeredAt: '2026-01-01T00:00:00.000Z' },
        {
          id: 'proj-m',
          name: 'missing',
          path: join(tempDir, 'missing'),
          registeredAt: '2026-01-01T00:00:00.000Z',
        },
      ],
    });

    expect(result.projectsImported).toBe(1);
    expect(result.projectsSkipped).toBe(1);
    expect(result.skipped).toHaveLength(1);
    expect(result.skipped[0].id).toBe('proj-m');
    expect(result.skipped[0].reason).toMatch(/not exist|missing|no .stoneforge/i);
  });
});
