/**
 * project command — manage the global projects registry.
 *
 * Subcommands:
 *   project import [path]  Register (or re-adopt) an existing workspace as a
 *                          project, then rebuild the global SQLite cache.
 *   project list           List registered projects.
 *
 * The registry lives at `~/.stoneforge/projects.json`; the global cache
 * lives at `~/.stoneforge/stoneforge.db`. The cache is disposable and is
 * rebuilt on every import from each project's JSONL source-of-truth. This
 * keeps the cache incapable of drifting from the on-disk truth.
 */

import { existsSync, readFileSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';
import * as yaml from 'yaml';
import type { Command, CommandOption, CommandResult, GlobalOptions } from '../types.js';
import { ExitCode, failure, success, OutputMode } from '../types.js';
import { getOutputMode } from '../formatter.js';
import {
  createProjectRegistryService,
  getGlobalStoneforgeDir,
  getGlobalDbPath,
  getRegistryPath,
  ProjectPathError,
  ProjectRegistryError,
  rebuildGlobalCache,
  type Project,
  type ProjectRegistryService,
  type RebuildResult,
} from '../../projects/index.js';

// ============================================================================
// project import
// ============================================================================

interface ProjectImportOptions {
  name?: string;
}

const projectImportOptions: CommandOption[] = [
  {
    name: 'name',
    short: 'n',
    description:
      'Name to register under (overrides config.yaml name and the directory basename)',
    hasValue: true,
  },
];

async function projectImportHandler(
  args: string[],
  options: GlobalOptions & ProjectImportOptions
): Promise<CommandResult> {
  const rawPath = args[0] ?? process.cwd();
  const projectRoot = resolve(rawPath);
  const desiredName = resolveProjectName(projectRoot, options.name);

  let service: ProjectRegistryService;
  try {
    service = createProjectRegistryService();
  } catch (err) {
    if (err instanceof ProjectRegistryError) {
      return failure(
        `Failed to load registry at ${getRegistryPath()}: ${err.message}`,
        ExitCode.GENERAL_ERROR
      );
    }
    throw err;
  }

  const upsert = upsertProject(service, projectRoot, desiredName);
  if ('error' in upsert) {
    return upsert.error;
  }

  let rebuild: RebuildResult;
  try {
    rebuild = rebuildGlobalCache({
      dbPath: getGlobalDbPath(),
      projects: service.list(),
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return failure(`Failed to rebuild global cache: ${msg}`, ExitCode.GENERAL_ERROR);
  }

  return success(
    {
      action: upsert.action,
      project: upsert.project,
      registryPath: getRegistryPath(),
      rebuild,
    },
    formatImportMessage(upsert.action, upsert.project, rebuild)
  );
}

/** Outcome returned by the upsert helper. */
type UpsertOutcome =
  | { action: 'registered' | 'updated' | 'unchanged'; project: Project }
  | { error: CommandResult };

/**
 * Registers a new project, or adopts an already-registered path. The
 * behavior is idempotent so `sf project import` can safely be re-run:
 *
 *   - no entry at this path   → create (validates .git presence)
 *   - entry with same name    → unchanged
 *   - entry with different name → rename
 */
function upsertProject(
  service: ProjectRegistryService,
  projectRoot: string,
  desiredName: string
): UpsertOutcome {
  const existing = service.getByPath(projectRoot);

  if (!existing) {
    try {
      const project = service.create({ path: projectRoot, name: desiredName });
      return { action: 'registered', project };
    } catch (err) {
      if (err instanceof ProjectPathError) {
        return { error: failure(err.message, ExitCode.VALIDATION) };
      }
      if (err instanceof ProjectRegistryError) {
        return { error: failure(err.message, ExitCode.VALIDATION) };
      }
      throw err;
    }
  }

  if (existing.name === desiredName) {
    return { action: 'unchanged', project: existing };
  }

  try {
    const project = service.update(existing.id, { name: desiredName });
    return { action: 'updated', project };
  } catch (err) {
    if (err instanceof ProjectRegistryError) {
      return { error: failure(err.message, ExitCode.VALIDATION) };
    }
    throw err;
  }
}

function formatImportMessage(
  action: 'registered' | 'updated' | 'unchanged',
  project: Project,
  rebuild: RebuildResult
): string {
  const verb =
    action === 'registered'
      ? 'Registered'
      : action === 'updated'
        ? 'Updated'
        : 'Already registered';

  const lines = [
    `${verb} project "${project.name}" (${project.id})`,
    `  Path:     ${project.path}`,
    `  Registry: ${getRegistryPath()}`,
    `  Cache:    ${rebuild.dbPath}`,
    `  Rebuilt:  ${rebuild.projectsImported} project(s), ${rebuild.totalElementsImported} element(s), ${rebuild.totalDependenciesImported} dependency(ies)`,
  ];

  if (rebuild.projectsSkipped > 0) {
    lines.push(`  Skipped:  ${rebuild.projectsSkipped} project(s)`);
    for (const s of rebuild.skipped) {
      lines.push(`    - ${s.name} (${s.id}): ${s.reason}`);
    }
  }

  return lines.join('\n');
}

const projectImportCommand: Command = {
  name: 'import',
  description: 'Register an existing workspace as a project',
  usage: 'sf project import [path] [--name <name>]',
  help: `Register an existing workspace as a project in the global registry
at ~/.stoneforge/projects.json, then rebuild the global SQLite cache at
~/.stoneforge/stoneforge.db from every registered project's JSONL source
of truth.

The path must be a git repository. Re-running the command for an already
registered path is safe: if --name differs, the entry is renamed; if it
matches, the command is a no-op (other than the cache rebuild).

Arguments:
  path                 Path to the workspace (default: current directory)

Options:
  -n, --name <name>    Name to register under (default: config.yaml name,
                       or the directory basename)

Examples:
  sf project import                       # register the current workspace
  sf project import /path/to/other-repo
  sf project import . --name my-project`,
  options: projectImportOptions,
  handler: projectImportHandler as Command['handler'],
};

// ============================================================================
// project list
// ============================================================================

async function projectListHandler(
  _args: string[],
  options: GlobalOptions
): Promise<CommandResult> {
  let service: ProjectRegistryService;
  try {
    service = createProjectRegistryService();
  } catch (err) {
    if (err instanceof ProjectRegistryError) {
      return failure(
        `Failed to load registry at ${getRegistryPath()}: ${err.message}`,
        ExitCode.GENERAL_ERROR
      );
    }
    throw err;
  }

  const projects = service.list();
  const data = {
    registryPath: getRegistryPath(),
    globalDir: getGlobalStoneforgeDir(),
    dbPath: getGlobalDbPath(),
    projects,
  };

  if (getOutputMode(options) === OutputMode.QUIET) {
    return success(data, projects.map((p) => p.id).join('\n'));
  }

  if (projects.length === 0) {
    return success(
      data,
      [
        'No projects registered.',
        `Registry: ${getRegistryPath()}`,
        'Run "sf project import [path]" to register one.',
      ].join('\n')
    );
  }

  return success(data, formatProjectList(projects));
}

const projectListCommand: Command = {
  name: 'list',
  description: 'List registered projects',
  usage: 'sf project list',
  help: `List every project registered in ~/.stoneforge/projects.json.

Examples:
  sf project list
  sf project list --json
  sf project list --quiet     # one id per line, useful for scripts`,
  handler: projectListHandler as Command['handler'],
};

// ============================================================================
// Root project command
// ============================================================================

export const projectCommand: Command = {
  name: 'project',
  description: 'Manage registered projects (multi-project support)',
  usage: 'sf project <subcommand> [options]',
  help: `Manage the set of Stoneforge workspaces registered on this machine.

Subcommands:
  import        Register an existing workspace as a project
  list          List registered projects

The registry lives at ~/.stoneforge/projects.json. The shared global
SQLite cache lives at ~/.stoneforge/stoneforge.db and is rebuilt from
every registered project's JSONL on every import.

Examples:
  sf project import
  sf project import /path/to/workspace --name my-project
  sf project list`,
  subcommands: {
    import: projectImportCommand,
    list: projectListCommand,
    ls: projectListCommand,
  },
  handler: async (args, options): Promise<CommandResult> => {
    if (args.length === 0) {
      return projectListHandler([], options);
    }
    return failure(
      `Unknown subcommand: ${args[0]}\n\nRun "sf project --help" to see available subcommands.`,
      ExitCode.INVALID_ARGUMENTS
    );
  },
};

// ============================================================================
// Helpers — name resolution and formatting
// ============================================================================

/**
 * Resolves the name to register under. Priority:
 *   1. --name flag (trimmed, non-empty)
 *   2. `name` field in <projectRoot>/.stoneforge/config.yaml
 *   3. basename of the project root
 */
function resolveProjectName(projectRoot: string, override?: string): string {
  if (override !== undefined) {
    const trimmed = override.trim();
    if (trimmed.length > 0) return trimmed;
  }
  const fromConfig = readNameFromConfig(projectRoot);
  if (fromConfig) return fromConfig;
  return basename(projectRoot);
}

function readNameFromConfig(projectRoot: string): string | null {
  const configPath = join(projectRoot, '.stoneforge', 'config.yaml');
  if (!existsSync(configPath)) return null;
  try {
    const parsed = yaml.parse(readFileSync(configPath, 'utf-8'));
    if (parsed && typeof parsed === 'object' && typeof parsed.name === 'string') {
      const trimmed = parsed.name.trim();
      return trimmed.length > 0 ? trimmed : null;
    }
  } catch {
    // A malformed config.yaml is not fatal here — fall through to basename.
    return null;
  }
  return null;
}

function formatProjectList(projects: Project[]): string {
  const rows = projects.map((p) => ({
    id: p.id,
    name: p.name,
    path: p.path,
    registeredAt: p.registeredAt,
  }));

  const idW = Math.max(2, ...rows.map((r) => r.id.length));
  const nameW = Math.max(4, ...rows.map((r) => r.name.length));

  const header = `${pad('ID', idW)}  ${pad('NAME', nameW)}  PATH`;
  const separator = `${'-'.repeat(idW)}  ${'-'.repeat(nameW)}  ----`;
  const lines = rows.map(
    (r) => `${pad(r.id, idW)}  ${pad(r.name, nameW)}  ${r.path}`
  );

  return [
    header,
    separator,
    ...lines,
    '',
    `${projects.length} project(s) registered`,
  ].join('\n');
}

function pad(value: string, width: number): string {
  if (value.length >= width) return value;
  return value + ' '.repeat(width - value.length);
}
