/**
 * Projects registry tests
 */

import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { existsSync, mkdirSync, rmSync, readFileSync, writeFileSync, mkdtempSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  readRegistry,
  writeRegistry,
  addOrUpdateProject,
  removeProject,
  findProjectByPath,
  validateProjectPath,
  ProjectPathError,
  type ProjectRegistry,
} from './registry.js';

function createValidProject(root: string): string {
  const stoneforge = join(root, '.stoneforge');
  const sync = join(stoneforge, 'sync');
  mkdirSync(sync, { recursive: true });
  writeFileSync(join(sync, 'elements.jsonl'), '');
  writeFileSync(join(sync, 'dependencies.jsonl'), '');
  return root;
}

describe('projects/registry', () => {
  let tempDir: string;
  let registryPath: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'sf-registry-test-'));
    registryPath = join(tempDir, 'projects.json');
  });

  afterEach(() => {
    try {
      rmSync(tempDir, { recursive: true, force: true });
    } catch {
      // ignore
    }
  });

  describe('readRegistry', () => {
    it('returns empty registry when file does not exist', () => {
      const registry = readRegistry(registryPath);
      expect(registry.version).toBe(1);
      expect(registry.projects).toEqual([]);
    });

    it('reads a valid registry file', () => {
      const data: ProjectRegistry = {
        version: 1,
        projects: [
          {
            id: 'proj-abcd',
            name: 'example',
            path: '/abs/path',
            registeredAt: '2026-01-01T00:00:00.000Z',
          },
        ],
      };
      writeFileSync(registryPath, JSON.stringify(data));
      const registry = readRegistry(registryPath);
      expect(registry.projects).toHaveLength(1);
      expect(registry.projects[0].name).toBe('example');
    });

    it('throws on malformed JSON', () => {
      writeFileSync(registryPath, '{not valid json');
      expect(() => readRegistry(registryPath)).toThrow();
    });

    it('throws on unsupported version', () => {
      writeFileSync(registryPath, JSON.stringify({ version: 99, projects: [] }));
      expect(() => readRegistry(registryPath)).toThrow(/version/i);
    });
  });

  describe('writeRegistry', () => {
    it('writes atomically and produces valid JSON', () => {
      const registry: ProjectRegistry = {
        version: 1,
        projects: [
          { id: 'proj-1', name: 'a', path: '/a', registeredAt: '2026-01-01T00:00:00.000Z' },
        ],
      };
      writeRegistry(registryPath, registry);
      expect(existsSync(registryPath)).toBe(true);
      const parsed = JSON.parse(readFileSync(registryPath, 'utf-8'));
      expect(parsed.version).toBe(1);
      expect(parsed.projects).toHaveLength(1);
    });

    it('creates the parent directory if missing', () => {
      const nested = join(tempDir, 'nested', 'dir', 'projects.json');
      writeRegistry(nested, { version: 1, projects: [] });
      expect(existsSync(nested)).toBe(true);
    });

    it('does not leave temp files behind after success', () => {
      writeRegistry(registryPath, { version: 1, projects: [] });
      const tempGlobMatches = require('node:fs')
        .readdirSync(tempDir)
        .filter((f: string) => f.includes('.tmp-'));
      expect(tempGlobMatches).toEqual([]);
    });
  });

  describe('addOrUpdateProject', () => {
    it('adds a new project with generated id', () => {
      const projectRoot = createValidProject(join(tempDir, 'proj-a'));
      const registry: ProjectRegistry = { version: 1, projects: [] };
      const result = addOrUpdateProject(registry, { path: projectRoot, name: 'proj-a' });
      expect(result.registry.projects).toHaveLength(1);
      expect(result.entry.name).toBe('proj-a');
      expect(result.entry.id).toMatch(/^proj-[a-z0-9]+$/);
      expect(result.entry.path).toBe(projectRoot);
      expect(result.entry.registeredAt).toMatch(/\d{4}-\d{2}-\d{2}T/);
      expect(result.added).toBe(true);
    });

    it('updates an existing project when path matches', () => {
      const projectRoot = createValidProject(join(tempDir, 'proj-a'));
      let registry: ProjectRegistry = { version: 1, projects: [] };
      const first = addOrUpdateProject(registry, { path: projectRoot, name: 'old-name' });
      registry = first.registry;
      const second = addOrUpdateProject(registry, { path: projectRoot, name: 'new-name' });
      expect(second.registry.projects).toHaveLength(1);
      expect(second.entry.name).toBe('new-name');
      expect(second.entry.id).toBe(first.entry.id);
      expect(second.added).toBe(false);
    });

    it('generates unique ids across multiple projects', () => {
      const a = createValidProject(join(tempDir, 'a'));
      const b = createValidProject(join(tempDir, 'b'));
      let registry: ProjectRegistry = { version: 1, projects: [] };
      registry = addOrUpdateProject(registry, { path: a, name: 'a' }).registry;
      registry = addOrUpdateProject(registry, { path: b, name: 'b' }).registry;
      const [first, second] = registry.projects;
      expect(first.id).not.toBe(second.id);
    });

    it('rejects duplicate names on different paths', () => {
      const a = createValidProject(join(tempDir, 'a'));
      const b = createValidProject(join(tempDir, 'b'));
      let registry: ProjectRegistry = { version: 1, projects: [] };
      registry = addOrUpdateProject(registry, { path: a, name: 'dup' }).registry;
      expect(() => addOrUpdateProject(registry, { path: b, name: 'dup' })).toThrow(/name/i);
    });
  });

  describe('findProjectByPath', () => {
    it('finds by absolute path', () => {
      const projectRoot = createValidProject(join(tempDir, 'x'));
      const registry: ProjectRegistry = {
        version: 1,
        projects: [
          { id: 'proj-1', name: 'x', path: projectRoot, registeredAt: '2026-01-01T00:00:00.000Z' },
        ],
      };
      const found = findProjectByPath(registry, projectRoot);
      expect(found?.id).toBe('proj-1');
    });

    it('returns undefined for unknown path', () => {
      const registry: ProjectRegistry = { version: 1, projects: [] };
      expect(findProjectByPath(registry, '/does/not/exist')).toBeUndefined();
    });
  });

  describe('removeProject', () => {
    it('removes a project by id', () => {
      const registry: ProjectRegistry = {
        version: 1,
        projects: [
          { id: 'proj-1', name: 'a', path: '/a', registeredAt: '2026-01-01T00:00:00.000Z' },
          { id: 'proj-2', name: 'b', path: '/b', registeredAt: '2026-01-01T00:00:00.000Z' },
        ],
      };
      const result = removeProject(registry, 'proj-1');
      expect(result.registry.projects).toHaveLength(1);
      expect(result.registry.projects[0].id).toBe('proj-2');
      expect(result.removed).toBe(true);
    });

    it('returns removed=false for unknown id', () => {
      const registry: ProjectRegistry = {
        version: 1,
        projects: [
          { id: 'proj-1', name: 'a', path: '/a', registeredAt: '2026-01-01T00:00:00.000Z' },
        ],
      };
      const result = removeProject(registry, 'proj-nope');
      expect(result.removed).toBe(false);
      expect(result.registry.projects).toHaveLength(1);
    });
  });

  describe('validateProjectPath', () => {
    it('accepts a directory with .stoneforge/sync/elements.jsonl', () => {
      const root = createValidProject(join(tempDir, 'ok'));
      expect(() => validateProjectPath(root)).not.toThrow();
    });

    it('rejects a missing path', () => {
      expect(() => validateProjectPath(join(tempDir, 'nope'))).toThrow(ProjectPathError);
    });

    it('rejects a path without .stoneforge/', () => {
      const root = join(tempDir, 'noforge');
      mkdirSync(root, { recursive: true });
      expect(() => validateProjectPath(root)).toThrow(/stoneforge/i);
    });

    it('rejects a .stoneforge/ without sync/elements.jsonl', () => {
      const root = join(tempDir, 'nosync');
      mkdirSync(join(root, '.stoneforge'), { recursive: true });
      expect(() => validateProjectPath(root)).toThrow(/elements\.jsonl/i);
    });
  });
});
