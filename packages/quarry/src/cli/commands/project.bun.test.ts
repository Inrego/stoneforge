/**
 * sf project command tests
 */

import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { projectCommand } from './project.js';
import { ExitCode, DEFAULT_GLOBAL_OPTIONS } from '../types.js';

function writeMinimalWorkspace(
  root: string,
  opts?: { configName?: string; elements?: string[] }
): string {
  const stoneforge = join(root, '.stoneforge');
  const sync = join(stoneforge, 'sync');
  mkdirSync(sync, { recursive: true });

  if (opts?.configName !== undefined) {
    writeFileSync(join(stoneforge, 'config.yaml'), `name: ${opts.configName}\n`);
  }
  const elements = opts?.elements ?? [
    JSON.stringify({
      id: 'el-e001',
      type: 'entity',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
      createdBy: 'el-e001',
      tags: [],
      metadata: {},
      name: 'op',
      entityType: 'human',
    }),
  ];
  writeFileSync(join(sync, 'elements.jsonl'), elements.join('\n') + '\n');
  writeFileSync(join(sync, 'dependencies.jsonl'), '');
  return root;
}

describe('projectCommand', () => {
  let tempDir: string;
  let homeDir: string;
  let originalHome: string | undefined;
  let originalUserprofile: string | undefined;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'sf-project-cmd-test-'));
    homeDir = join(tempDir, 'home');
    mkdirSync(homeDir, { recursive: true });
    // Redirect os.homedir() to an isolated temp home so the test does
    // not touch the real ~/.stoneforge/.
    originalHome = process.env.HOME;
    originalUserprofile = process.env.USERPROFILE;
    process.env.HOME = homeDir;
    process.env.USERPROFILE = homeDir;
  });

  afterEach(() => {
    if (originalHome === undefined) {
      delete process.env.HOME;
    } else {
      process.env.HOME = originalHome;
    }
    if (originalUserprofile === undefined) {
      delete process.env.USERPROFILE;
    } else {
      process.env.USERPROFILE = originalUserprofile;
    }
    try {
      rmSync(tempDir, { recursive: true, force: true });
    } catch {
      // ignore
    }
  });

  describe('command definition', () => {
    it('has name "project"', () => {
      expect(projectCommand.name).toBe('project');
    });

    it('has subcommands import and list', () => {
      expect(projectCommand.subcommands).toBeDefined();
      expect(projectCommand.subcommands!.import).toBeDefined();
      expect(projectCommand.subcommands!.list).toBeDefined();
    });
  });

  describe('project import', () => {
    it('registers a workspace and writes registry file + global DB', async () => {
      const project = writeMinimalWorkspace(join(tempDir, 'my-workspace'), {
        configName: 'my-workspace',
      });
      const importCmd = projectCommand.subcommands!.import;

      const result = await importCmd.handler([project], {
        ...DEFAULT_GLOBAL_OPTIONS,
      });

      expect(result.exitCode).toBe(ExitCode.SUCCESS);
      const registryPath = join(homeDir, '.stoneforge', 'projects.json');
      const registry = JSON.parse(readFileSync(registryPath, 'utf-8'));
      expect(registry.version).toBe(1);
      expect(registry.projects).toHaveLength(1);
      expect(registry.projects[0].name).toBe('my-workspace');
      expect(registry.projects[0].path).toBe(project);
    });

    it('defaults to cwd when no path argument is given', async () => {
      const project = writeMinimalWorkspace(join(tempDir, 'cwd-project'), {
        configName: 'cwd-project',
      });
      const importCmd = projectCommand.subcommands!.import;

      const originalCwd = process.cwd();
      try {
        process.chdir(project);
        const result = await importCmd.handler([], { ...DEFAULT_GLOBAL_OPTIONS });
        expect(result.exitCode).toBe(ExitCode.SUCCESS);
      } finally {
        process.chdir(originalCwd);
      }

      const registry = JSON.parse(
        readFileSync(join(homeDir, '.stoneforge', 'projects.json'), 'utf-8')
      );
      expect(registry.projects[0].path).toBe(project);
    });

    it('uses --name to override config.yaml name', async () => {
      const project = writeMinimalWorkspace(join(tempDir, 'proj'), {
        configName: 'config-name',
      });
      const importCmd = projectCommand.subcommands!.import;

      const result = await importCmd.handler([project], {
        ...DEFAULT_GLOBAL_OPTIONS,
        name: 'override-name',
      });

      expect(result.exitCode).toBe(ExitCode.SUCCESS);
      const registry = JSON.parse(
        readFileSync(join(homeDir, '.stoneforge', 'projects.json'), 'utf-8')
      );
      expect(registry.projects[0].name).toBe('override-name');
    });

    it('falls back to basename when no --name or config name is set', async () => {
      const project = writeMinimalWorkspace(join(tempDir, 'basename-proj'));
      const importCmd = projectCommand.subcommands!.import;

      const result = await importCmd.handler([project], {
        ...DEFAULT_GLOBAL_OPTIONS,
      });

      expect(result.exitCode).toBe(ExitCode.SUCCESS);
      const registry = JSON.parse(
        readFileSync(join(homeDir, '.stoneforge', 'projects.json'), 'utf-8')
      );
      expect(registry.projects[0].name).toBe('basename-proj');
    });

    it('fails cleanly when the path is not a Stoneforge workspace', async () => {
      const notAWorkspace = join(tempDir, 'not-a-workspace');
      mkdirSync(notAWorkspace);
      const importCmd = projectCommand.subcommands!.import;

      const result = await importCmd.handler([notAWorkspace], {
        ...DEFAULT_GLOBAL_OPTIONS,
      });

      expect(result.exitCode).toBe(ExitCode.VALIDATION);
      expect(result.error).toMatch(/stoneforge/i);
    });

    it('updates the name when re-importing the same path', async () => {
      const project = writeMinimalWorkspace(join(tempDir, 'same'), {
        configName: 'original',
      });
      const importCmd = projectCommand.subcommands!.import;

      await importCmd.handler([project], { ...DEFAULT_GLOBAL_OPTIONS });
      const result = await importCmd.handler([project], {
        ...DEFAULT_GLOBAL_OPTIONS,
        name: 'renamed',
      });

      expect(result.exitCode).toBe(ExitCode.SUCCESS);
      const registry = JSON.parse(
        readFileSync(join(homeDir, '.stoneforge', 'projects.json'), 'utf-8')
      );
      expect(registry.projects).toHaveLength(1);
      expect(registry.projects[0].name).toBe('renamed');
    });

    it('registers two different projects independently', async () => {
      const a = writeMinimalWorkspace(join(tempDir, 'a'), { configName: 'a' });
      const b = writeMinimalWorkspace(join(tempDir, 'b'), { configName: 'b' });
      const importCmd = projectCommand.subcommands!.import;

      await importCmd.handler([a], { ...DEFAULT_GLOBAL_OPTIONS });
      const result = await importCmd.handler([b], { ...DEFAULT_GLOBAL_OPTIONS });

      expect(result.exitCode).toBe(ExitCode.SUCCESS);
      const registry = JSON.parse(
        readFileSync(join(homeDir, '.stoneforge', 'projects.json'), 'utf-8')
      );
      expect(registry.projects).toHaveLength(2);
      expect(registry.projects.map((p: { name: string }) => p.name).sort()).toEqual(['a', 'b']);
    });
  });

  describe('project list', () => {
    it('prints "no projects registered" when the registry is empty', async () => {
      const listCmd = projectCommand.subcommands!.list;
      const result = await listCmd.handler([], { ...DEFAULT_GLOBAL_OPTIONS });
      expect(result.exitCode).toBe(ExitCode.SUCCESS);
      expect(result.message ?? '').toMatch(/no projects/i);
    });

    it('lists registered projects after import', async () => {
      const a = writeMinimalWorkspace(join(tempDir, 'alpha'), { configName: 'alpha' });
      const b = writeMinimalWorkspace(join(tempDir, 'beta'), { configName: 'beta' });
      const importCmd = projectCommand.subcommands!.import;
      await importCmd.handler([a], { ...DEFAULT_GLOBAL_OPTIONS });
      await importCmd.handler([b], { ...DEFAULT_GLOBAL_OPTIONS });

      const listCmd = projectCommand.subcommands!.list;
      const result = await listCmd.handler([], { ...DEFAULT_GLOBAL_OPTIONS });
      expect(result.exitCode).toBe(ExitCode.SUCCESS);
      expect(result.message).toContain('alpha');
      expect(result.message).toContain('beta');
    });

    it('returns structured data in --json mode', async () => {
      const a = writeMinimalWorkspace(join(tempDir, 'json-proj'), {
        configName: 'json-proj',
      });
      const importCmd = projectCommand.subcommands!.import;
      await importCmd.handler([a], { ...DEFAULT_GLOBAL_OPTIONS });

      const listCmd = projectCommand.subcommands!.list;
      const result = await listCmd.handler([], { ...DEFAULT_GLOBAL_OPTIONS, json: true });
      expect(result.exitCode).toBe(ExitCode.SUCCESS);
      const data = result.data as { projects: Array<{ name: string }> };
      expect(Array.isArray(data.projects)).toBe(true);
      expect(data.projects[0].name).toBe('json-proj');
    });
  });
});
