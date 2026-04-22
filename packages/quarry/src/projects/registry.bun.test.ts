/**
 * Tests for the pure projects registry module.
 *
 * These cover:
 *   - validateProjectPath (file/dir/git-repo detection)
 *   - readRegistry (missing file, malformed, wrong version, ok)
 *   - writeRegistry (round-trip, atomic temp cleanup)
 *   - addProject / updateProject / removeProject / findBy*
 */

import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  CURRENT_REGISTRY_VERSION,
  ProjectPathError,
  ProjectRegistryError,
  addProject,
  emptyRegistry,
  findProjectById,
  findProjectByPath,
  readRegistry,
  removeProject,
  updateProject,
  validateProjectPath,
  writeRegistry,
  type ProjectRegistry,
} from './registry.js';

// ============================================================================
// Test helpers
// ============================================================================

let sandbox: string;

beforeEach(() => {
  sandbox = mkdtempSync(join(tmpdir(), 'sf-registry-'));
});

afterEach(() => {
  rmSync(sandbox, { recursive: true, force: true });
});

function makeGitDir(name: string): string {
  const root = join(sandbox, name);
  mkdirSync(join(root, '.git'), { recursive: true });
  return root;
}

function makeGitWorktree(name: string): string {
  const root = join(sandbox, name);
  mkdirSync(root, { recursive: true });
  writeFileSync(join(root, '.git'), 'gitdir: /some/real/gitdir\n', 'utf-8');
  return root;
}

function makePlainDir(name: string): string {
  const root = join(sandbox, name);
  mkdirSync(root, { recursive: true });
  return root;
}

// ============================================================================
// validateProjectPath
// ============================================================================

describe('validateProjectPath', () => {
  test('accepts a directory with a .git subdirectory', () => {
    const root = makeGitDir('repo');
    expect(() => validateProjectPath(root)).not.toThrow();
  });

  test('accepts a directory with a .git gitdir-pointer file (worktree)', () => {
    const root = makeGitWorktree('worktree');
    expect(() => validateProjectPath(root)).not.toThrow();
  });

  test('rejects a path that does not exist', () => {
    expect(() => validateProjectPath(join(sandbox, 'missing'))).toThrow(ProjectPathError);
  });

  test('rejects a file that is not a directory', () => {
    const file = join(sandbox, 'not-a-dir');
    writeFileSync(file, 'hi');
    expect(() => validateProjectPath(file)).toThrow(ProjectPathError);
  });

  test('rejects a directory without a .git entry', () => {
    const root = makePlainDir('no-git');
    expect(() => validateProjectPath(root)).toThrow(/Not a git repository/);
  });

  test('rejects a .git file without a gitdir: pointer', () => {
    const root = join(sandbox, 'bad-git-file');
    mkdirSync(root);
    writeFileSync(join(root, '.git'), 'not a pointer\n');
    expect(() => validateProjectPath(root)).toThrow(/Not a git repository/);
  });
});

// ============================================================================
// readRegistry
// ============================================================================

describe('readRegistry', () => {
  test('returns empty v1 registry when file is missing', () => {
    const reg = readRegistry(join(sandbox, 'nope.json'));
    expect(reg.version).toBe(CURRENT_REGISTRY_VERSION);
    expect(reg.projects).toEqual([]);
  });

  test('round-trips through writeRegistry', () => {
    const path = join(sandbox, 'r.json');
    const registry: ProjectRegistry = {
      version: CURRENT_REGISTRY_VERSION,
      projects: [
        {
          id: 'proj-deadbeef',
          name: 'alpha',
          path: join(sandbox, 'alpha'),
          registeredAt: '2026-04-22T00:00:00.000Z',
        },
      ],
    };
    writeRegistry(path, registry);
    expect(readRegistry(path)).toEqual(registry);
  });

  test('throws on malformed JSON', () => {
    const path = join(sandbox, 'bad.json');
    writeFileSync(path, '{ not json', 'utf-8');
    expect(() => readRegistry(path)).toThrow(ProjectRegistryError);
  });

  test('throws on unsupported registry version', () => {
    const path = join(sandbox, 'v999.json');
    writeFileSync(path, JSON.stringify({ version: 999, projects: [] }), 'utf-8');
    expect(() => readRegistry(path)).toThrow(/Unsupported registry version/);
  });

  test('throws on missing required entry fields', () => {
    const path = join(sandbox, 'missing.json');
    writeFileSync(
      path,
      JSON.stringify({ version: 1, projects: [{ id: 'proj-1' }] }),
      'utf-8'
    );
    expect(() => readRegistry(path)).toThrow(/missing required fields/);
  });

  test('throws when root shape is wrong', () => {
    const path = join(sandbox, 'wrong.json');
    writeFileSync(path, JSON.stringify({ version: 1, projects: 'nope' }), 'utf-8');
    expect(() => readRegistry(path)).toThrow(/valid registry object/);
  });
});

// ============================================================================
// writeRegistry
// ============================================================================

describe('writeRegistry', () => {
  test('creates missing parent directories', () => {
    const nested = join(sandbox, 'a', 'b', 'c', 'r.json');
    writeRegistry(nested, emptyRegistry());
    const onDisk = JSON.parse(readFileSync(nested, 'utf-8'));
    expect(onDisk.version).toBe(CURRENT_REGISTRY_VERSION);
  });

  test('does not leave a temp file after a successful write', () => {
    const path = join(sandbox, 'clean.json');
    writeRegistry(path, emptyRegistry());
    const leftovers = readdirSync(sandbox).filter((n) => n.startsWith('clean.json.tmp-'));
    expect(leftovers).toEqual([]);
  });

  test('cleans up temp file when rename fails (target is a non-empty directory)', () => {
    // A non-empty directory at the target path forces renameSync to fail on
    // Node/Bun across platforms (ENOTEMPTY / EISDIR), giving us a
    // deterministic I/O failure to observe.
    const target = join(sandbox, 'blocked.json');
    mkdirSync(target);
    writeFileSync(join(target, 'keep.txt'), 'x');
    expect(() => writeRegistry(target, emptyRegistry())).toThrow(ProjectRegistryError);
    const leftovers = readdirSync(sandbox).filter((n) => n.startsWith('blocked.json.tmp-'));
    expect(leftovers).toEqual([]);
  });
});

// ============================================================================
// addProject / updateProject / removeProject
// ============================================================================

describe('addProject', () => {
  test('adds a new entry and preserves existing ones', () => {
    const reg0 = emptyRegistry();
    const { registry: reg1, entry: a } = addProject(reg0, {
      path: join(sandbox, 'a'),
      name: 'a',
    });
    const { registry: reg2, entry: b } = addProject(reg1, {
      path: join(sandbox, 'b'),
      name: 'b',
    });

    expect(reg2.projects.map((p) => p.id)).toEqual([a.id, b.id]);
    expect(a.id).toMatch(/^proj-[0-9a-f]{8}$/);
    expect(a.id).not.toBe(b.id);
  });

  test('rejects an empty name', () => {
    expect(() =>
      addProject(emptyRegistry(), { path: join(sandbox, 'a'), name: '   ' })
    ).toThrow(/cannot be empty/);
  });

  test('rejects a duplicate path', () => {
    const { registry } = addProject(emptyRegistry(), {
      path: join(sandbox, 'a'),
      name: 'a',
    });
    expect(() =>
      addProject(registry, { path: join(sandbox, 'a'), name: 'a-other' })
    ).toThrow(/already registered/);
  });

  test('rejects a duplicate name', () => {
    const { registry } = addProject(emptyRegistry(), {
      path: join(sandbox, 'a'),
      name: 'same',
    });
    expect(() =>
      addProject(registry, { path: join(sandbox, 'b'), name: 'same' })
    ).toThrow(/A project with name/);
  });

  test('name uniqueness is case-insensitive but preserves original casing', () => {
    const { registry, entry } = addProject(emptyRegistry(), {
      path: join(sandbox, 'a'),
      name: 'Alpha',
    });
    expect(entry.name).toBe('Alpha');
    expect(() =>
      addProject(registry, { path: join(sandbox, 'b'), name: 'alpha' })
    ).toThrow(/already registered/);
  });
});

describe('updateProject', () => {
  test('renames an existing project', () => {
    const { registry: r1, entry } = addProject(emptyRegistry(), {
      path: join(sandbox, 'a'),
      name: 'old',
    });
    const { registry: r2, entry: updated } = updateProject(r1, entry.id, { name: 'new' });
    expect(updated.name).toBe('new');
    expect(updated.id).toBe(entry.id);
    expect(r2.projects[0].name).toBe('new');
  });

  test('throws on unknown id', () => {
    expect(() => updateProject(emptyRegistry(), 'proj-none', { name: 'x' })).toThrow(
      /No project with id/
    );
  });

  test('rejects a name that collides with a different project', () => {
    const { registry: r1 } = addProject(emptyRegistry(), {
      path: join(sandbox, 'a'),
      name: 'a',
    });
    const { registry: r2, entry: bEntry } = addProject(r1, {
      path: join(sandbox, 'b'),
      name: 'b',
    });
    expect(() => updateProject(r2, bEntry.id, { name: 'a' })).toThrow(/already registered/);
  });

  test('allows a same-name-different-case rename (self is not a collision)', () => {
    const { registry, entry } = addProject(emptyRegistry(), {
      path: join(sandbox, 'a'),
      name: 'Alpha',
    });
    const { entry: renamed } = updateProject(registry, entry.id, { name: 'ALPHA' });
    expect(renamed.name).toBe('ALPHA');
  });
});

describe('removeProject', () => {
  test('removes an existing entry and reports it', () => {
    const { registry: r1, entry } = addProject(emptyRegistry(), {
      path: join(sandbox, 'a'),
      name: 'a',
    });
    const { registry: r2, removed } = removeProject(r1, entry.id);
    expect(removed).toBe(true);
    expect(r2.projects).toEqual([]);
  });

  test('is a no-op for unknown ids', () => {
    const { registry: r1 } = addProject(emptyRegistry(), {
      path: join(sandbox, 'a'),
      name: 'a',
    });
    const { registry: r2, removed } = removeProject(r1, 'proj-does-not-exist');
    expect(removed).toBe(false);
    expect(r2.projects).toHaveLength(1);
  });
});

describe('findProjectBy*', () => {
  test('finds entries by id and by absolute path', () => {
    const { registry, entry } = addProject(emptyRegistry(), {
      path: join(sandbox, 'a'),
      name: 'a',
    });
    expect(findProjectById(registry, entry.id)).toEqual(entry);
    expect(findProjectByPath(registry, join(sandbox, 'a'))).toEqual(entry);
    expect(findProjectById(registry, 'proj-none')).toBeUndefined();
    expect(findProjectByPath(registry, join(sandbox, 'none'))).toBeUndefined();
  });
});
