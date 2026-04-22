/**
 * Project Registry Service
 *
 * Manages the global ~/.stoneforge/projects.json file — the list of
 * Stoneforge workspaces the local user has registered through the Smithy
 * dashboard. Exposes CRUD operations and filesystem path validation.
 *
 * Deliberately minimal: this service is the "registry service" that backs
 * the Projects page (el-65c). The downstream task el-56c will extend this
 * (richer metadata, migrations), and el-1zb introduces a Project element
 * type that can subsume the on-disk registry. Until then, this module is
 * the authoritative read/write surface for ~/.stoneforge/projects.json.
 *
 * Registry shape (v1):
 *
 *   {
 *     "version": 1,
 *     "projects": [
 *       {
 *         "id":           "proj-abc12345",
 *         "name":         "my-workspace",
 *         "path":         "/abs/path/to/workspace",
 *         "registeredAt": "2026-04-22T12:00:00.000Z"
 *       }
 *     ]
 *   }
 *
 * The `proj-` id prefix keeps the namespace decoupled from the core element
 * system (`el-*`) until the Project element type lands.
 *
 * The file format is intentionally identical to the CLI's projects foundation
 * (el-26x) so that the CLI and dashboard share one registry on disk.
 */

import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { randomBytes } from 'node:crypto';
import { createLogger } from '../../utils/logger.js';

const logger = createLogger('orchestrator');

// ============================================================================
// Constants
// ============================================================================

export const GLOBAL_STONEFORGE_DIR = '.stoneforge';
export const PROJECTS_REGISTRY_FILE = 'projects.json';
export const CURRENT_REGISTRY_VERSION = 1 as const;

const PROJECT_ID_PREFIX = 'proj-';
const PROJECT_ID_BYTES = 4; // 8 hex chars
const MAX_ID_GENERATION_ATTEMPTS = 10;

// ============================================================================
// Types
// ============================================================================

export interface ProjectRegistryEntry {
  id: string;
  name: string;
  path: string;
  registeredAt: string;
}

export interface ProjectRegistry {
  version: typeof CURRENT_REGISTRY_VERSION;
  projects: ProjectRegistryEntry[];
}

export interface CreateProjectInput {
  name: string;
  path: string;
}

export interface UpdateProjectInput {
  name?: string;
  path?: string;
}

// ============================================================================
// Errors
// ============================================================================

export type ProjectErrorCode =
  | 'INVALID_INPUT'
  | 'PATH_NOT_FOUND'
  | 'PATH_NOT_DIRECTORY'
  | 'PATH_NOT_GIT_REPO'
  | 'NAME_ALREADY_EXISTS'
  | 'PATH_ALREADY_REGISTERED'
  | 'NOT_FOUND'
  | 'REGISTRY_CORRUPT'
  | 'REGISTRY_IO_ERROR';

export class ProjectRegistryError extends Error {
  constructor(
    public readonly code: ProjectErrorCode,
    message: string
  ) {
    super(message);
    this.name = 'ProjectRegistryError';
  }
}

// ============================================================================
// Path helpers
// ============================================================================

/** Returns the default registry file path (~/.stoneforge/projects.json). */
export function getDefaultRegistryPath(): string {
  // Honour STONEFORGE_PROJECTS_REGISTRY so tests (and CI) can point at a
  // scratch file instead of the user's real home directory.
  const override = process.env.STONEFORGE_PROJECTS_REGISTRY;
  if (override && override.length > 0) {
    return override;
  }
  return join(homedir(), GLOBAL_STONEFORGE_DIR, PROJECTS_REGISTRY_FILE);
}

// ============================================================================
// Validation
// ============================================================================

/**
 * Validates that `rawPath` refers to an existing directory that is a git
 * repository. Throws {@link ProjectRegistryError} on failure.
 *
 * A directory counts as a git repo when it contains a `.git` entry
 * (directory for a regular clone, file for a worktree/submodule). We
 * deliberately avoid invoking `git` so validation stays fast and usable
 * on machines without the CLI installed.
 */
export function validateProjectPath(rawPath: string): string {
  if (typeof rawPath !== 'string' || rawPath.trim().length === 0) {
    throw new ProjectRegistryError('INVALID_INPUT', 'path is required');
  }

  const abs = resolve(rawPath);

  if (!existsSync(abs)) {
    throw new ProjectRegistryError('PATH_NOT_FOUND', `Path does not exist: ${abs}`);
  }
  if (!statSync(abs).isDirectory()) {
    throw new ProjectRegistryError('PATH_NOT_DIRECTORY', `Path is not a directory: ${abs}`);
  }

  const gitEntry = join(abs, '.git');
  if (!existsSync(gitEntry)) {
    throw new ProjectRegistryError(
      'PATH_NOT_GIT_REPO',
      `Path is not a git repository (no .git entry at ${abs})`
    );
  }

  return abs;
}

/**
 * Validates a project name. Trimmed names must be non-empty and no longer
 * than 100 characters.
 */
export function validateProjectName(rawName: string): string {
  if (typeof rawName !== 'string') {
    throw new ProjectRegistryError('INVALID_INPUT', 'name is required');
  }
  const trimmed = rawName.trim();
  if (trimmed.length === 0) {
    throw new ProjectRegistryError('INVALID_INPUT', 'name is required');
  }
  if (trimmed.length > 100) {
    throw new ProjectRegistryError('INVALID_INPUT', 'name must be 100 characters or fewer');
  }
  return trimmed;
}

// ============================================================================
// Service
// ============================================================================

export interface ProjectRegistryService {
  /** Absolute path to the registry file this service is bound to. */
  readonly registryPath: string;
  /** Returns the current set of registered projects. */
  list(): ProjectRegistryEntry[];
  /** Finds a project by id, or undefined. */
  get(id: string): ProjectRegistryEntry | undefined;
  /** Registers a new project; throws on validation / conflict. */
  create(input: CreateProjectInput): Promise<ProjectRegistryEntry>;
  /** Updates a project by id; throws on missing, validation, or conflict. */
  update(id: string, input: UpdateProjectInput): Promise<ProjectRegistryEntry>;
  /** Removes a project by id. Returns false when the id is unknown. */
  remove(id: string): Promise<boolean>;
}

export interface ProjectRegistryServiceOptions {
  /** Override the registry file location (defaults to ~/.stoneforge/projects.json). */
  registryPath?: string;
}

export function createProjectRegistryService(
  options: ProjectRegistryServiceOptions = {}
): ProjectRegistryService {
  const registryPath = options.registryPath ?? getDefaultRegistryPath();

  function loadRegistry(): ProjectRegistry {
    return readRegistryFile(registryPath);
  }

  function persist(registry: ProjectRegistry): void {
    writeRegistryFile(registryPath, registry);
  }

  // Serialize mutations so two concurrent POST/PATCH/DELETE requests cannot
  // read-modify-write the same on-disk registry and silently clobber each
  // other. Cross-process races (e.g., the CLI running at the same time) are
  // still possible; they are mitigated by the atomic rename in persist().
  let mutationChain: Promise<unknown> = Promise.resolve();
  function withLock<T>(fn: () => T): Promise<T> {
    const next = mutationChain.then(fn, fn);
    // Swallow rejections on the chain so one failure doesn't taint the next
    // caller — each caller receives its own promise returned above.
    mutationChain = next.catch(() => undefined);
    return next;
  }

  function createLocked(input: CreateProjectInput): ProjectRegistryEntry {
    const name = validateProjectName(input.name);
    const absPath = validateProjectPath(input.path);

    const registry = loadRegistry();

    const existingByPath = registry.projects.find((p) => p.path === absPath);
    if (existingByPath) {
      throw new ProjectRegistryError(
        'PATH_ALREADY_REGISTERED',
        `A project is already registered at ${absPath} (id=${existingByPath.id})`
      );
    }

    const nameConflict = registry.projects.find((p) => p.name === name);
    if (nameConflict) {
      throw new ProjectRegistryError(
        'NAME_ALREADY_EXISTS',
        `A project named "${name}" is already registered (id=${nameConflict.id})`
      );
    }

    const entry: ProjectRegistryEntry = {
      id: generateProjectId(new Set(registry.projects.map((p) => p.id))),
      name,
      path: absPath,
      registeredAt: new Date().toISOString(),
    };

    persist({
      version: CURRENT_REGISTRY_VERSION,
      projects: [...registry.projects, entry],
    });

    logger.info(`Registered project ${entry.id} (${entry.name}) at ${entry.path}`);
    return entry;
  }

  function updateLocked(
    id: string,
    input: UpdateProjectInput
  ): ProjectRegistryEntry {
    const registry = loadRegistry();
    const current = registry.projects.find((p) => p.id === id);
    if (!current) {
      throw new ProjectRegistryError('NOT_FOUND', `No project with id ${id}`);
    }

    let nextName = current.name;
    if (input.name !== undefined) {
      nextName = validateProjectName(input.name);
      const nameConflict = registry.projects.find(
        (p) => p.name === nextName && p.id !== id
      );
      if (nameConflict) {
        throw new ProjectRegistryError(
          'NAME_ALREADY_EXISTS',
          `A project named "${nextName}" is already registered (id=${nameConflict.id})`
        );
      }
    }

    let nextPath = current.path;
    if (input.path !== undefined) {
      nextPath = validateProjectPath(input.path);
      const pathConflict = registry.projects.find(
        (p) => p.path === nextPath && p.id !== id
      );
      if (pathConflict) {
        throw new ProjectRegistryError(
          'PATH_ALREADY_REGISTERED',
          `A project is already registered at ${nextPath} (id=${pathConflict.id})`
        );
      }
    }

    const updated: ProjectRegistryEntry = {
      ...current,
      name: nextName,
      path: nextPath,
    };

    persist({
      version: CURRENT_REGISTRY_VERSION,
      projects: registry.projects.map((p) => (p.id === id ? updated : p)),
    });

    logger.info(
      `Updated project ${updated.id} (name="${updated.name}", path=${updated.path})`
    );
    return updated;
  }

  function removeLocked(id: string): boolean {
    const registry = loadRegistry();
    const next = registry.projects.filter((p) => p.id !== id);
    if (next.length === registry.projects.length) {
      return false;
    }
    persist({ version: CURRENT_REGISTRY_VERSION, projects: next });
    logger.info(`Removed project ${id}`);
    return true;
  }

  return {
    registryPath,

    list(): ProjectRegistryEntry[] {
      return loadRegistry().projects;
    },

    get(id: string): ProjectRegistryEntry | undefined {
      return loadRegistry().projects.find((p) => p.id === id);
    },

    create(input: CreateProjectInput): Promise<ProjectRegistryEntry> {
      return withLock(() => createLocked(input));
    },

    update(
      id: string,
      input: UpdateProjectInput
    ): Promise<ProjectRegistryEntry> {
      return withLock(() => updateLocked(id, input));
    },

    remove(id: string): Promise<boolean> {
      return withLock(() => removeLocked(id));
    },
  };
}

// ============================================================================
// File IO
// ============================================================================

function readRegistryFile(path: string): ProjectRegistry {
  if (!existsSync(path)) {
    return { version: CURRENT_REGISTRY_VERSION, projects: [] };
  }

  let raw: string;
  try {
    raw = readFileSync(path, 'utf-8');
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new ProjectRegistryError(
      'REGISTRY_IO_ERROR',
      `Failed to read registry at ${path}: ${msg}`
    );
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new ProjectRegistryError(
      'REGISTRY_CORRUPT',
      `Malformed JSON in registry at ${path}: ${msg}`
    );
  }

  if (!isRegistryShape(parsed)) {
    throw new ProjectRegistryError(
      'REGISTRY_CORRUPT',
      `Registry at ${path} does not match the expected shape`
    );
  }

  if (parsed.version !== CURRENT_REGISTRY_VERSION) {
    throw new ProjectRegistryError(
      'REGISTRY_CORRUPT',
      `Unsupported registry version ${parsed.version} at ${path} (expected ${CURRENT_REGISTRY_VERSION})`
    );
  }

  return {
    version: CURRENT_REGISTRY_VERSION,
    projects: parsed.projects.map((raw, i) => toEntry(raw, i, path)),
  };
}

function writeRegistryFile(path: string, registry: ProjectRegistry): void {
  const dir = dirname(path);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }

  // Atomic write: stage into a temp file and rename, so a crash cannot
  // leave the registry half-written.
  const tempPath = `${path}.tmp-${Date.now()}-${randomBytes(3).toString('hex')}`;
  const content = `${JSON.stringify(registry, null, 2)}\n`;

  try {
    writeFileSync(tempPath, content, 'utf-8');
    renameSync(tempPath, path);
  } catch (err) {
    if (existsSync(tempPath)) {
      try {
        rmSync(tempPath, { force: true });
      } catch {
        // Primary error wins; swallow cleanup failure.
      }
    }
    const msg = err instanceof Error ? err.message : String(err);
    throw new ProjectRegistryError(
      'REGISTRY_IO_ERROR',
      `Failed to write registry to ${path}: ${msg}`
    );
  }
}

// ============================================================================
// Internal helpers
// ============================================================================

function generateProjectId(taken: Set<string>): string {
  for (let attempt = 0; attempt < MAX_ID_GENERATION_ATTEMPTS; attempt++) {
    const candidate = `${PROJECT_ID_PREFIX}${randomBytes(PROJECT_ID_BYTES).toString('hex')}`;
    if (!taken.has(candidate)) {
      return candidate;
    }
  }
  throw new ProjectRegistryError(
    'REGISTRY_IO_ERROR',
    `Could not generate a unique project id after ${MAX_ID_GENERATION_ATTEMPTS} attempts`
  );
}

function isRegistryShape(value: unknown): value is { version: unknown; projects: unknown[] } {
  if (typeof value !== 'object' || value === null) return false;
  const obj = value as Record<string, unknown>;
  return 'version' in obj && Array.isArray(obj.projects);
}

function toEntry(raw: unknown, index: number, path: string): ProjectRegistryEntry {
  if (typeof raw !== 'object' || raw === null) {
    throw new ProjectRegistryError(
      'REGISTRY_CORRUPT',
      `Registry entry #${index} in ${path} is not an object`
    );
  }
  const obj = raw as Record<string, unknown>;
  const id = typeof obj.id === 'string' ? obj.id : undefined;
  const name = typeof obj.name === 'string' ? obj.name : undefined;
  const entryPath = typeof obj.path === 'string' ? obj.path : undefined;
  const registeredAt =
    typeof obj.registeredAt === 'string' ? obj.registeredAt : undefined;
  if (!id || !name || !entryPath || !registeredAt) {
    throw new ProjectRegistryError(
      'REGISTRY_CORRUPT',
      `Registry entry #${index} in ${path} is missing required fields (id, name, path, registeredAt)`
    );
  }
  return { id, name, path: entryPath, registeredAt };
}
