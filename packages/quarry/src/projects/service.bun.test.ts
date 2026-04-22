/**
 * Tests for the projects registry service factory.
 *
 * These exercise the disk-backed CRUD surface returned by
 * `createProjectRegistryService`, including path validation (git-repo
 * check) and the fail-fast boot behavior of
 * `tryLoadProjectRegistryService`.
 */

import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  createProjectRegistryService,
  loadProjectRegistryForBoot,
  tryLoadProjectRegistryService,
} from './service.js';
import { ProjectPathError, ProjectRegistryError } from './registry.js';

// ============================================================================
// Fixtures
// ============================================================================

let sandbox: string;
let registryPath: string;

beforeEach(() => {
  sandbox = mkdtempSync(join(tmpdir(), 'sf-registry-svc-'));
  registryPath = join(sandbox, 'projects.json');
});

afterEach(() => {
  rmSync(sandbox, { recursive: true, force: true });
});

function makeGitDir(name: string): string {
  const root = join(sandbox, name);
  mkdirSync(join(root, '.git'), { recursive: true });
  return root;
}

// ============================================================================
// create
// ============================================================================

describe('create', () => {
  test('persists a new entry and validates the path is a git repo', () => {
    const svc = createProjectRegistryService({ path: registryPath });
    const entry = svc.create({ path: makeGitDir('alpha'), name: 'alpha' });

    expect(entry.id).toMatch(/^proj-/);
    expect(svc.list()).toHaveLength(1);

    const onDisk = JSON.parse(readFileSync(registryPath, 'utf-8'));
    expect(onDisk.projects[0].name).toBe('alpha');
  });

  test('rejects a non-git directory', () => {
    const plain = join(sandbox, 'plain');
    mkdirSync(plain);
    const svc = createProjectRegistryService({ path: registryPath });
    expect(() => svc.create({ path: plain, name: 'plain' })).toThrow(ProjectPathError);
    expect(svc.list()).toEqual([]);
  });

  test('rejects a duplicate name', () => {
    const svc = createProjectRegistryService({ path: registryPath });
    svc.create({ path: makeGitDir('a'), name: 'shared' });
    expect(() =>
      svc.create({ path: makeGitDir('b'), name: 'shared' })
    ).toThrow(/already registered/);
  });
});

// ============================================================================
// update / remove / reload
// ============================================================================

describe('update', () => {
  test('persists renames and preserves id/path/registeredAt', () => {
    const svc = createProjectRegistryService({ path: registryPath });
    const before = svc.create({ path: makeGitDir('a'), name: 'a' });
    const after = svc.update(before.id, { name: 'renamed' });

    expect(after.id).toBe(before.id);
    expect(after.path).toBe(before.path);
    expect(after.registeredAt).toBe(before.registeredAt);
    expect(after.name).toBe('renamed');

    const fresh = createProjectRegistryService({ path: registryPath });
    expect(fresh.get(before.id)?.name).toBe('renamed');
  });
});

describe('remove', () => {
  test('returns false for unknown ids and true when something was removed', () => {
    const svc = createProjectRegistryService({ path: registryPath });
    const entry = svc.create({ path: makeGitDir('a'), name: 'a' });

    expect(svc.remove('proj-missing')).toBe(false);
    expect(svc.list()).toHaveLength(1);

    expect(svc.remove(entry.id)).toBe(true);
    expect(svc.list()).toEqual([]);

    const fresh = createProjectRegistryService({ path: registryPath });
    expect(fresh.list()).toEqual([]);
  });
});

describe('reload', () => {
  test('picks up changes made by another writer', () => {
    const svc = createProjectRegistryService({ path: registryPath });
    expect(svc.list()).toEqual([]);

    // Simulate another process adding an entry by writing the file directly.
    writeFileSync(
      registryPath,
      JSON.stringify(
        {
          version: 1,
          projects: [
            {
              id: 'proj-aabbccdd',
              name: 'external',
              path: join(sandbox, 'external'),
              registeredAt: '2026-04-22T00:00:00.000Z',
            },
          ],
        },
        null,
        2
      ),
      'utf-8'
    );

    svc.reload();
    expect(svc.list().map((p) => p.name)).toEqual(['external']);
  });
});

// ============================================================================
// Boot path
// ============================================================================

describe('tryLoadProjectRegistryService', () => {
  test('returns a service on success', () => {
    const result = tryLoadProjectRegistryService({ path: registryPath });
    expect('service' in result).toBe(true);
  });

  test('returns an error when the on-disk registry is malformed', () => {
    writeFileSync(registryPath, '{ broken', 'utf-8');
    const result = tryLoadProjectRegistryService({ path: registryPath });
    expect('error' in result).toBe(true);
    if ('error' in result) {
      expect(result.error).toBeInstanceOf(ProjectRegistryError);
    }
  });
});

describe('loadProjectRegistryForBoot', () => {
  test('returns an info-level log with project count on success', () => {
    const svc = createProjectRegistryService({ path: registryPath });
    svc.create({ path: makeGitDir('a'), name: 'a' });

    const boot = loadProjectRegistryForBoot({ path: registryPath });
    expect(boot.service).not.toBeNull();
    expect(boot.logLevel).toBe('info');
    expect(boot.message).toMatch(/Loaded projects registry \(1 project\)/);
  });

  test('pluralizes "projects" for zero or many', () => {
    const zero = loadProjectRegistryForBoot({ path: registryPath });
    expect(zero.message).toMatch(/\(0 projects\)/);
  });

  test('returns service=null and a warn-level log when the file is malformed', () => {
    writeFileSync(registryPath, '{ not json', 'utf-8');
    const boot = loadProjectRegistryForBoot({ path: registryPath });
    expect(boot.service).toBeNull();
    expect(boot.logLevel).toBe('warn');
    expect(boot.message).toMatch(/Failed to load projects registry/);
  });
});
