/**
 * Tests for the `project` CLI command.
 *
 * The tests isolate the global registry and global SQLite cache by setting
 * `STONEFORGE_HOME` to a per-test sandbox, so nothing in the user's real
 * `~/.stoneforge` is touched.
 */

import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { projectCommand } from './project.js';
import {
  DEFAULT_GLOBAL_OPTIONS,
  OutputMode,
  type CommandResult,
  type GlobalOptions,
} from '../types.js';
import {
  STONEFORGE_HOME_ENV,
  getGlobalDbPath,
  getRegistryPath,
} from '../../projects/index.js';

// ============================================================================
// Fixtures
// ============================================================================

let sandbox: string;
let stoneforgeHome: string;
let originalHome: string | undefined;

beforeEach(() => {
  sandbox = mkdtempSync(join(tmpdir(), 'sf-project-cli-'));
  stoneforgeHome = join(sandbox, 'home', '.stoneforge');
  originalHome = process.env[STONEFORGE_HOME_ENV];
  process.env[STONEFORGE_HOME_ENV] = stoneforgeHome;
});

afterEach(() => {
  if (originalHome === undefined) {
    delete process.env[STONEFORGE_HOME_ENV];
  } else {
    process.env[STONEFORGE_HOME_ENV] = originalHome;
  }
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

function makeGitDir(name: string, opts: { withSync?: boolean; configName?: string } = {}): string {
  const root = join(sandbox, name);
  mkdirSync(join(root, '.git'), { recursive: true });
  if (opts.withSync !== false) {
    mkdirSync(join(root, '.stoneforge'), { recursive: true });
  }
  if (opts.configName !== undefined) {
    mkdirSync(join(root, '.stoneforge'), { recursive: true });
    writeFileSync(
      join(root, '.stoneforge', 'config.yaml'),
      `name: ${opts.configName}\n`,
      'utf-8'
    );
  }
  return root;
}

function options(overrides: Partial<GlobalOptions> = {}): GlobalOptions {
  return { ...DEFAULT_GLOBAL_OPTIONS, ...overrides };
}

function getImport(): NonNullable<typeof projectCommand.subcommands>['import'] {
  const sub = projectCommand.subcommands?.import;
  if (!sub) throw new Error('project.subcommands.import not registered');
  return sub;
}

function getList(): NonNullable<typeof projectCommand.subcommands>['list'] {
  const sub = projectCommand.subcommands?.list;
  if (!sub) throw new Error('project.subcommands.list not registered');
  return sub;
}

async function runImport(
  args: string[],
  opts: Partial<GlobalOptions> & { name?: string } = {}
): Promise<CommandResult> {
  const cmd = getImport();
  return cmd.handler(args, options(opts) as GlobalOptions & Record<string, unknown>);
}

async function runList(
  opts: Partial<GlobalOptions> = {}
): Promise<CommandResult> {
  const cmd = getList();
  return cmd.handler([], options(opts) as GlobalOptions & Record<string, unknown>);
}

// ============================================================================
// command definition
// ============================================================================

describe('projectCommand', () => {
  test('registers import and list subcommands (with ls alias)', () => {
    expect(projectCommand.subcommands).toBeDefined();
    expect(Object.keys(projectCommand.subcommands!).sort()).toEqual([
      'import',
      'list',
      'ls',
    ]);
    expect(projectCommand.subcommands!.ls).toBe(projectCommand.subcommands!.list);
  });

  test('default handler (no subcommand) returns the list output', async () => {
    const result = await projectCommand.handler([], options());
    expect(result.exitCode).toBe(0);
    expect(result.message).toMatch(/No projects registered/);
  });

  test('default handler rejects unknown subcommands', async () => {
    const result = await projectCommand.handler(['frobnicate'], options());
    expect(result.exitCode).not.toBe(0);
    expect(result.error).toMatch(/Unknown subcommand/);
  });
});

// ============================================================================
// project import
// ============================================================================

describe('project import', () => {
  test('registers a new project, rebuilds cache, and persists to disk', async () => {
    const repo = makeGitDir('alpha');
    const result = await runImport([repo]);

    expect(result.exitCode).toBe(0);
    const data = result.data as {
      action: string;
      project: { id: string; name: string; path: string };
      registryPath: string;
      rebuild: { dbPath: string; projectsImported: number };
    };
    expect(data.action).toBe('registered');
    expect(data.project.path).toBe(repo);
    expect(data.project.name).toBe('alpha');
    expect(data.project.id).toMatch(/^proj-[0-9a-f]{8}$/);

    // Registry file was written under STONEFORGE_HOME.
    expect(data.registryPath).toBe(getRegistryPath());
    const onDisk = JSON.parse(readFileSync(getRegistryPath(), 'utf-8'));
    expect(onDisk.projects).toHaveLength(1);
    expect(onDisk.projects[0].name).toBe('alpha');

    // Global DB was created at the expected global path.
    expect(data.rebuild.dbPath).toBe(getGlobalDbPath());
    expect(existsSync(getGlobalDbPath())).toBe(true);
    expect(data.rebuild.projectsImported).toBe(1);
  });

  test('prefers --name over config.yaml and basename', async () => {
    const repo = makeGitDir('alpha', { configName: 'from-config' });
    const result = await runImport([repo], { name: 'from-flag' });

    expect(result.exitCode).toBe(0);
    const data = result.data as { project: { name: string } };
    expect(data.project.name).toBe('from-flag');
  });

  test('falls back to config.yaml name when --name is not given', async () => {
    const repo = makeGitDir('alpha', { configName: 'from-config' });
    const result = await runImport([repo]);

    expect(result.exitCode).toBe(0);
    const data = result.data as { project: { name: string } };
    expect(data.project.name).toBe('from-config');
  });

  test('re-importing the same path is idempotent (unchanged)', async () => {
    const repo = makeGitDir('alpha');
    const first = await runImport([repo]);
    expect(first.exitCode).toBe(0);
    const firstData = first.data as { project: { id: string } };

    const second = await runImport([repo]);
    expect(second.exitCode).toBe(0);
    const secondData = second.data as { action: string; project: { id: string } };
    expect(secondData.action).toBe('unchanged');
    expect(secondData.project.id).toBe(firstData.project.id);

    const onDisk = JSON.parse(readFileSync(getRegistryPath(), 'utf-8'));
    expect(onDisk.projects).toHaveLength(1);
  });

  test('re-importing with a different --name renames the entry', async () => {
    const repo = makeGitDir('alpha');
    const first = await runImport([repo], { name: 'original' });
    expect(first.exitCode).toBe(0);

    const second = await runImport([repo], { name: 'renamed' });
    expect(second.exitCode).toBe(0);
    const data = second.data as { action: string; project: { id: string; name: string } };
    expect(data.action).toBe('updated');
    expect(data.project.name).toBe('renamed');

    const onDisk = JSON.parse(readFileSync(getRegistryPath(), 'utf-8'));
    expect(onDisk.projects[0].name).toBe('renamed');
  });

  test('rejects a path that is not a git repository', async () => {
    const plain = join(sandbox, 'not-a-repo');
    mkdirSync(plain);
    const result = await runImport([plain]);
    expect(result.exitCode).not.toBe(0);
    expect(result.error).toMatch(/Not a git repository/);
  });

  test('rejects a second project trying to steal an existing name', async () => {
    const a = makeGitDir('a');
    const b = makeGitDir('b');
    await runImport([a], { name: 'shared' });
    const result = await runImport([b], { name: 'shared' });
    expect(result.exitCode).not.toBe(0);
    expect(result.error).toMatch(/already registered/);
  });
});

// ============================================================================
// project list
// ============================================================================

describe('project list', () => {
  test('reports "no projects" when the registry is empty', async () => {
    const result = await runList();
    expect(result.exitCode).toBe(0);
    expect(result.message).toMatch(/No projects registered/);
    const data = result.data as { projects: unknown[] };
    expect(data.projects).toEqual([]);
  });

  test('lists all registered projects in a table', async () => {
    await runImport([makeGitDir('alpha')]);
    await runImport([makeGitDir('betaxxxx')]);

    const result = await runList();
    expect(result.exitCode).toBe(0);
    expect(result.message).toContain('alpha');
    expect(result.message).toContain('betaxxxx');
    expect(result.message).toMatch(/2 project\(s\) registered/);
  });

  test('quiet mode emits one project id per line', async () => {
    await runImport([makeGitDir('alpha')]);
    await runImport([makeGitDir('betaxxxx')]);

    const result = await runList({ quiet: true });
    expect(result.exitCode).toBe(0);
    const lines = (result.message ?? '').split('\n').filter(Boolean);
    expect(lines).toHaveLength(2);
    for (const line of lines) {
      expect(line).toMatch(/^proj-[0-9a-f]{8}$/);
    }
    // Sanity check — OutputMode type is still referenced.
    expect(OutputMode.QUIET).toBe('quiet');
  });
});
