/**
 * project command - manage the multi-project registry
 *
 * Subcommands:
 *   project import [path]  Register an existing workspace as a project.
 *                          Rebuilds the global SQLite cache afterwards.
 *   project list           List registered projects.
 *
 * The registry lives at ~/.stoneforge/projects.json; the global cache lives
 * at ~/.stoneforge/stoneforge.db. The cache is disposable and is rebuilt on
 * every import from the JSONL source-of-truth of each registered project.
 */

import { existsSync, readFileSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';
import * as yaml from 'yaml';
import type { Command, CommandOption, CommandResult, GlobalOptions } from '../types.js';
import { ExitCode, failure, success } from '../types.js';
import { getOutputMode } from '../formatter.js';
import { OutputMode } from '../types.js';
import {
  addOrUpdateProject,
  getGlobalDbPath,
  getGlobalStoneforgeDir,
  getRegistryPath,
  ProjectPathError,
  ProjectRegistryError,
  readRegistry,
  rebuildGlobalCache,
  validateProjectPath,
  writeRegistry,
  type ProjectRegistry,
  type ProjectRegistryEntry,
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
    description: 'Name for the project (overrides config.yaml name and directory basename)',
    hasValue: true,
  },
];

async function projectImportHandler(
  args: string[],
  options: GlobalOptions & ProjectImportOptions
): Promise<CommandResult> {
  const rawPath = args[0] ?? process.cwd();
  const projectRoot = resolve(rawPath);

  try {
    validateProjectPath(projectRoot);
  } catch (err) {
    if (err instanceof ProjectPathError) {
      return failure(err.message, ExitCode.VALIDATION);
    }
    throw err;
  }

  const name = resolveProjectName(projectRoot, options.name);

  let registry: ProjectRegistry;
  try {
    registry = readRegistry();
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return failure(`Failed to read registry: ${msg}`, ExitCode.GENERAL_ERROR);
  }

  let updateResult: ReturnType<typeof addOrUpdateProject>;
  try {
    updateResult = addOrUpdateProject(registry, { path: projectRoot, name });
  } catch (err) {
    if (err instanceof ProjectRegistryError) {
      return failure(err.message, ExitCode.VALIDATION);
    }
    throw err;
  }

  try {
    writeRegistry(getRegistryPath(), updateResult.registry);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return failure(`Failed to write registry: ${msg}`, ExitCode.GENERAL_ERROR);
  }

  let rebuildResult;
  try {
    rebuildResult = rebuildGlobalCache({
      dbPath: getGlobalDbPath(),
      projects: updateResult.registry.projects,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return failure(`Failed to rebuild global cache: ${msg}`, ExitCode.GENERAL_ERROR);
  }

  const action = updateResult.added ? 'Registered' : 'Updated';
  const message = [
    `${action} project "${updateResult.entry.name}" (${updateResult.entry.id})`,
    `  Path:     ${updateResult.entry.path}`,
    `  Registry: ${getRegistryPath()}`,
    `  Cache:    ${rebuildResult.dbPath}`,
    `  Rebuilt:  ${rebuildResult.projectsImported} project(s), ${rebuildResult.totalElementsImported} element(s)`,
  ];

  if (rebuildResult.projectsSkipped > 0) {
    message.push(`  Skipped:  ${rebuildResult.projectsSkipped} project(s) (path missing or invalid)`);
    for (const s of rebuildResult.skipped) {
      message.push(`    - ${s.name} (${s.id}): ${s.reason}`);
    }
  }

  return success(
    {
      added: updateResult.added,
      project: updateResult.entry,
      registryPath: getRegistryPath(),
      rebuild: rebuildResult,
    },
    message.join('\n')
  );
}

const projectImportCommand: Command = {
  name: 'import',
  description: 'Register an existing workspace as a project',
  usage: 'sf project import [path] [--name <name>]',
  help: `Register an existing .stoneforge/ workspace as a project in the
global registry at ~/.stoneforge/projects.json, then rebuild the global
SQLite cache at ~/.stoneforge/stoneforge.db from every registered
project's JSONL source of truth.

Arguments:
  path                 Path to the workspace (default: current directory)

Options:
  -n, --name <name>    Name to register (default: config.yaml name, or the
                       directory basename)

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
  let registry: ProjectRegistry;
  try {
    registry = readRegistry();
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return failure(`Failed to read registry: ${msg}`, ExitCode.GENERAL_ERROR);
  }

  const data = {
    registryPath: getRegistryPath(),
    globalDir: getGlobalStoneforgeDir(),
    projects: registry.projects,
  };

  if (getOutputMode(options) === OutputMode.QUIET) {
    return success(data, registry.projects.map((p) => p.id).join('\n'));
  }

  if (registry.projects.length === 0) {
    return success(
      data,
      `No projects registered.\nRegistry: ${getRegistryPath()}\nRun "sf project import [path]" to register one.`
    );
  }

  const message = formatProjectList(registry.projects);
  return success(data, message);
}

const projectListCommand: Command = {
  name: 'list',
  description: 'List registered projects',
  usage: 'sf project list',
  help: `List every project registered in ~/.stoneforge/projects.json.

Examples:
  sf project list
  sf project list --json`,
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
// Helpers
// ============================================================================

/**
 * Resolves the name to register under. Priority:
 *   1. --name flag
 *   2. name field in <projectRoot>/.stoneforge/config.yaml
 *   3. basename of the project root
 */
function resolveProjectName(projectRoot: string, override?: string): string {
  if (override && override.trim().length > 0) {
    return override.trim();
  }
  const fromConfig = readNameFromConfig(projectRoot);
  if (fromConfig) {
    return fromConfig;
  }
  return basename(projectRoot);
}

function readNameFromConfig(projectRoot: string): string | null {
  const configPath = join(projectRoot, '.stoneforge', 'config.yaml');
  if (!existsSync(configPath)) {
    return null;
  }
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

function formatProjectList(projects: ProjectRegistryEntry[]): string {
  const rows = projects.map((p) => ({
    id: p.id,
    name: p.name,
    path: p.path,
    registeredAt: p.registeredAt,
  }));

  const idW = Math.max(2, ...rows.map((r) => r.id.length));
  const nameW = Math.max(4, ...rows.map((r) => r.name.length));

  const header = `${pad('ID', idW)}  ${pad('NAME', nameW)}  PATH`;
  const sep = `${'-'.repeat(idW)}  ${'-'.repeat(nameW)}  ----`;
  const lines = rows.map(
    (r) => `${pad(r.id, idW)}  ${pad(r.name, nameW)}  ${r.path}`
  );

  return [header, sep, ...lines, '', `${projects.length} project(s) registered`].join('\n');
}

function pad(s: string, w: number): string {
  if (s.length >= w) return s;
  return s + ' '.repeat(w - s.length);
}
