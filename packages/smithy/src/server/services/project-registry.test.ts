/**
 * Tests for the project registry service.
 *
 * The service persists to disk, so each test points it at a unique
 * scratch file under the OS temp dir and cleans up afterwards.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  existsSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
  mkdirSync,
  readFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import {
  createProjectRegistryService,
  ProjectRegistryError,
  CURRENT_REGISTRY_VERSION,
  type ProjectRegistryService,
} from './project-registry.js';

async function expectRejects(
  fn: () => Promise<unknown>,
  code: string
): Promise<void> {
  try {
    await fn();
  } catch (err) {
    expect(err).toBeInstanceOf(ProjectRegistryError);
    expect((err as ProjectRegistryError).code).toBe(code);
    return;
  }
  throw new Error(`expected rejection with code ${code}`);
}

describe('projectRegistryService', () => {
  let tmpRoot: string;
  let registryPath: string;
  let gitProjectA: string;
  let gitProjectB: string;
  let service: ProjectRegistryService;

  beforeEach(() => {
    tmpRoot = mkdtempSync(join(tmpdir(), 'sf-projects-'));
    registryPath = join(tmpRoot, 'projects.json');

    gitProjectA = join(tmpRoot, 'project-a');
    mkdirSync(join(gitProjectA, '.git'), { recursive: true });

    gitProjectB = join(tmpRoot, 'project-b');
    mkdirSync(join(gitProjectB, '.git'), { recursive: true });

    service = createProjectRegistryService({ registryPath });
  });

  afterEach(() => {
    rmSync(tmpRoot, { recursive: true, force: true });
  });

  describe('list / get', () => {
    it('returns an empty array when the registry file is missing', () => {
      expect(service.list()).toEqual([]);
    });

    it('returns undefined when fetching an unknown id', () => {
      expect(service.get('proj-missing')).toBeUndefined();
    });
  });

  describe('create', () => {
    it('registers a project and persists it to disk', async () => {
      const entry = await service.create({ name: 'Alpha', path: gitProjectA });

      expect(entry.id).toMatch(/^proj-[0-9a-f]{8}$/);
      expect(entry.name).toBe('Alpha');
      expect(entry.path).toBe(resolve(gitProjectA));
      expect(entry.registeredAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);

      expect(existsSync(registryPath)).toBe(true);

      // Re-read through a fresh service to confirm persistence.
      const reopened = createProjectRegistryService({ registryPath });
      expect(reopened.list()).toEqual([entry]);
      expect(reopened.get(entry.id)).toEqual(entry);
    });

    it('trims whitespace in names', async () => {
      const entry = await service.create({ name: '  Trim Me  ', path: gitProjectA });
      expect(entry.name).toBe('Trim Me');
    });

    it('rejects missing name', async () => {
      await expectRejects(
        () => service.create({ name: '   ', path: gitProjectA }),
        'INVALID_INPUT'
      );
    });

    it('rejects names longer than 100 chars', async () => {
      const longName = 'x'.repeat(101);
      await expectRejects(
        () => service.create({ name: longName, path: gitProjectA }),
        'INVALID_INPUT'
      );
    });

    it('rejects a non-existent path', async () => {
      await expectRejects(
        () => service.create({ name: 'Ghost', path: join(tmpRoot, 'does-not-exist') }),
        'PATH_NOT_FOUND'
      );
    });

    it('rejects a path that is not a directory', async () => {
      const filePath = join(tmpRoot, 'not-a-dir.txt');
      writeFileSync(filePath, 'hello', 'utf-8');
      await expectRejects(
        () => service.create({ name: 'NotDir', path: filePath }),
        'PATH_NOT_DIRECTORY'
      );
    });

    it('rejects a directory that is not a git repository', async () => {
      const nonGit = join(tmpRoot, 'plain-dir');
      mkdirSync(nonGit, { recursive: true });
      await expectRejects(
        () => service.create({ name: 'Plain', path: nonGit }),
        'PATH_NOT_GIT_REPO'
      );
    });

    it('accepts a directory where .git is a file (worktree style)', async () => {
      const worktreeDir = join(tmpRoot, 'worktree');
      mkdirSync(worktreeDir, { recursive: true });
      writeFileSync(join(worktreeDir, '.git'), 'gitdir: /somewhere/else\n', 'utf-8');
      const entry = await service.create({ name: 'Worktree', path: worktreeDir });
      expect(entry.path).toBe(resolve(worktreeDir));
    });

    it('rejects duplicate paths', async () => {
      await service.create({ name: 'First', path: gitProjectA });
      await expectRejects(
        () => service.create({ name: 'Second', path: gitProjectA }),
        'PATH_ALREADY_REGISTERED'
      );
    });

    it('rejects duplicate names', async () => {
      await service.create({ name: 'Shared', path: gitProjectA });
      await expectRejects(
        () => service.create({ name: 'Shared', path: gitProjectB }),
        'NAME_ALREADY_EXISTS'
      );
    });

    it('serializes concurrent creates so duplicate-name conflicts are detected deterministically', async () => {
      // Fire two overlapping creates for the same name; one must succeed and
      // the other must reject with NAME_ALREADY_EXISTS.
      const results = await Promise.allSettled([
        service.create({ name: 'Race', path: gitProjectA }),
        service.create({ name: 'Race', path: gitProjectB }),
      ]);

      const fulfilled = results.filter((r) => r.status === 'fulfilled');
      const rejected = results.filter((r) => r.status === 'rejected');
      expect(fulfilled).toHaveLength(1);
      expect(rejected).toHaveLength(1);
      expect(
        (rejected[0] as PromiseRejectedResult).reason
      ).toBeInstanceOf(ProjectRegistryError);
      expect(
        ((rejected[0] as PromiseRejectedResult).reason as ProjectRegistryError).code
      ).toBe('NAME_ALREADY_EXISTS');

      // And exactly one entry lands on disk.
      expect(service.list()).toHaveLength(1);
    });
  });

  describe('update', () => {
    it('renames a project', async () => {
      const original = await service.create({ name: 'Alpha', path: gitProjectA });
      const updated = await service.update(original.id, { name: 'Alpha v2' });
      expect(updated.name).toBe('Alpha v2');
      expect(updated.id).toBe(original.id);
      expect(updated.registeredAt).toBe(original.registeredAt);
      expect(updated.path).toBe(original.path);
    });

    it('relocates a project to a new git directory', async () => {
      const original = await service.create({ name: 'Movable', path: gitProjectA });
      const updated = await service.update(original.id, { path: gitProjectB });
      expect(updated.path).toBe(resolve(gitProjectB));
      expect(updated.id).toBe(original.id);
    });

    it('returns NOT_FOUND for unknown ids', async () => {
      await expectRejects(
        () => service.update('proj-missing', { name: 'Whatever' }),
        'NOT_FOUND'
      );
    });

    it('rejects a rename that collides with another project', async () => {
      await service.create({ name: 'Alpha', path: gitProjectA });
      const beta = await service.create({ name: 'Beta', path: gitProjectB });
      await expectRejects(
        () => service.update(beta.id, { name: 'Alpha' }),
        'NAME_ALREADY_EXISTS'
      );
    });

    it('rejects a relocate that collides with another project', async () => {
      await service.create({ name: 'Alpha', path: gitProjectA });
      const beta = await service.create({ name: 'Beta', path: gitProjectB });
      await expectRejects(
        () => service.update(beta.id, { path: gitProjectA }),
        'PATH_ALREADY_REGISTERED'
      );
    });

    it('does not collide with the same project on a no-op rename', async () => {
      const original = await service.create({ name: 'Alpha', path: gitProjectA });
      const same = await service.update(original.id, {
        name: 'Alpha',
        path: gitProjectA,
      });
      expect(same.name).toBe('Alpha');
      expect(same.path).toBe(resolve(gitProjectA));
    });
  });

  describe('remove', () => {
    it('removes a project and persists the change', async () => {
      const entry = await service.create({ name: 'Alpha', path: gitProjectA });
      expect(await service.remove(entry.id)).toBe(true);
      expect(service.list()).toEqual([]);

      const reopened = createProjectRegistryService({ registryPath });
      expect(reopened.list()).toEqual([]);
    });

    it('returns false for unknown ids', async () => {
      expect(await service.remove('proj-unknown')).toBe(false);
    });
  });

  describe('file format', () => {
    it('writes a v1-shaped JSON file readable by other readers', async () => {
      await service.create({ name: 'Alpha', path: gitProjectA });

      const raw = readFileSync(registryPath, 'utf-8');
      const parsed = JSON.parse(raw) as {
        version: number;
        projects: Array<Record<string, unknown>>;
      };
      expect(parsed.version).toBe(CURRENT_REGISTRY_VERSION);
      expect(parsed.projects).toHaveLength(1);
      expect(parsed.projects[0]).toEqual(
        expect.objectContaining({
          id: expect.stringMatching(/^proj-/),
          name: 'Alpha',
          path: resolve(gitProjectA),
          registeredAt: expect.any(String),
        })
      );
    });

    it('treats a missing registry file as empty', () => {
      const freshService = createProjectRegistryService({
        registryPath: join(tmpRoot, 'nope.json'),
      });
      expect(freshService.list()).toEqual([]);
    });

    it('rejects a registry file with the wrong version', () => {
      writeFileSync(
        registryPath,
        JSON.stringify({ version: 99, projects: [] }),
        'utf-8'
      );
      try {
        service.list();
        throw new Error('expected REGISTRY_CORRUPT');
      } catch (err) {
        expect(err).toBeInstanceOf(ProjectRegistryError);
        expect((err as ProjectRegistryError).code).toBe('REGISTRY_CORRUPT');
      }
    });

    it('rejects malformed JSON', () => {
      writeFileSync(registryPath, 'not json {{{', 'utf-8');
      try {
        service.list();
        throw new Error('expected REGISTRY_CORRUPT');
      } catch (err) {
        expect(err).toBeInstanceOf(ProjectRegistryError);
        expect((err as ProjectRegistryError).code).toBe('REGISTRY_CORRUPT');
      }
    });
  });
});
