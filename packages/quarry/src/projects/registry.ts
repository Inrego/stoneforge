/**
 * Projects Registry
 *
 * Manages the global ~/.stoneforge/projects.json file, which records the
 * set of Stoneforge workspaces that the local machine knows about.
 *
 * This is intentionally minimal for the multi-project foundation: it is a
 * plain JSON file read/written by the CLI. A fuller registry service with
 * richer metadata (git remote, default branch, etc.) and a proper Project
 * element type are introduced by downstream tasks (el-56c, el-1zb).
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
 * All IDs use the `proj-` prefix to stay out of the `el-` namespace used
 * by the core element system — this keeps the two stores decoupled until
 * el-1zb formally introduces Project as an element type.
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

// ============================================================================
// Constants
// ============================================================================

export const GLOBAL_STONEFORGE_DIR = '.stoneforge';
export const PROJECTS_REGISTRY_FILE = 'projects.json';
export const GLOBAL_DB_FILE = 'stoneforge.db';

export const CURRENT_REGISTRY_VERSION = 1 as const;
const PROJECT_ID_PREFIX = 'proj-';
const PROJECT_ID_BYTES = 4; // 8 hex chars, collision-safe for the registry

// ============================================================================
// Types
// ============================================================================

export interface ProjectRegistryEntry {
  /** Short identifier (proj-xxxx) used by the registry and CLI. */
  id: string;
  /** Human-readable name. Unique within the registry. */
  name: string;
  /** Absolute filesystem path to the project root (parent of .stoneforge/). */
  path: string;
  /** ISO timestamp of first registration (unchanged on update). */
  registeredAt: string;
}

export interface ProjectRegistry {
  version: typeof CURRENT_REGISTRY_VERSION;
  projects: ProjectRegistryEntry[];
}

export interface AddProjectInput {
  path: string;
  name: string;
}

export interface AddProjectResult {
  registry: ProjectRegistry;
  entry: ProjectRegistryEntry;
  added: boolean;
}

export interface RemoveProjectResult {
  registry: ProjectRegistry;
  removed: boolean;
}

// ============================================================================
// Errors
// ============================================================================

export class ProjectPathError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ProjectPathError';
  }
}

export class ProjectRegistryError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ProjectRegistryError';
  }
}

// ============================================================================
// Path helpers
// ============================================================================

/** Returns the global ~/.stoneforge directory path. */
export function getGlobalStoneforgeDir(): string {
  return join(homedir(), GLOBAL_STONEFORGE_DIR);
}

/** Returns the absolute path to the projects registry file. */
export function getRegistryPath(): string {
  return join(getGlobalStoneforgeDir(), PROJECTS_REGISTRY_FILE);
}

/** Returns the absolute path to the global SQLite cache. */
export function getGlobalDbPath(): string {
  return join(getGlobalStoneforgeDir(), GLOBAL_DB_FILE);
}

// ============================================================================
// Validation
// ============================================================================

/**
 * Validates that `projectRoot` looks like an initialized Stoneforge workspace.
 *
 * Checks:
 *   1. The directory exists.
 *   2. `<projectRoot>/.stoneforge/` exists.
 *   3. `<projectRoot>/.stoneforge/sync/elements.jsonl` exists (source of truth).
 *
 * Throws {@link ProjectPathError} on failure.
 */
export function validateProjectPath(projectRoot: string): void {
  const abs = resolve(projectRoot);

  if (!existsSync(abs)) {
    throw new ProjectPathError(`Path does not exist: ${abs}`);
  }
  if (!statSync(abs).isDirectory()) {
    throw new ProjectPathError(`Path is not a directory: ${abs}`);
  }

  const stoneforgeDir = join(abs, GLOBAL_STONEFORGE_DIR);
  if (!existsSync(stoneforgeDir) || !statSync(stoneforgeDir).isDirectory()) {
    throw new ProjectPathError(
      `No .stoneforge/ directory at ${abs}. Run "sf init" inside the project first.`
    );
  }

  const elementsFile = join(stoneforgeDir, 'sync', 'elements.jsonl');
  if (!existsSync(elementsFile)) {
    throw new ProjectPathError(
      `Missing ${elementsFile}. JSONL sync files are the source of truth; run "sf export" in the project first.`
    );
  }
}

// ============================================================================
// Read / Write
// ============================================================================

/**
 * Reads the registry from disk. Returns an empty v1 registry when the file
 * does not exist.
 *
 * Throws {@link ProjectRegistryError} if the file is malformed or versioned
 * ahead of this CLI.
 */
export function readRegistry(path: string = getRegistryPath()): ProjectRegistry {
  if (!existsSync(path)) {
    return { version: CURRENT_REGISTRY_VERSION, projects: [] };
  }

  let raw: string;
  try {
    raw = readFileSync(path, 'utf-8');
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new ProjectRegistryError(`Failed to read registry at ${path}: ${msg}`);
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new ProjectRegistryError(`Malformed JSON in registry at ${path}: ${msg}`);
  }

  if (!isRegistryLike(parsed)) {
    throw new ProjectRegistryError(
      `Registry at ${path} is not a valid projects registry object`
    );
  }
  if (parsed.version !== CURRENT_REGISTRY_VERSION) {
    throw new ProjectRegistryError(
      `Unsupported registry version ${parsed.version} at ${path} (expected ${CURRENT_REGISTRY_VERSION})`
    );
  }

  return {
    version: CURRENT_REGISTRY_VERSION,
    projects: parsed.projects.map(toEntry),
  };
}

/**
 * Writes the registry to disk atomically (write temp file + rename).
 * Creates parent directories if missing.
 */
export function writeRegistry(path: string, registry: ProjectRegistry): void {
  const dir = dirname(path);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }

  const tempPath = `${path}.tmp-${Date.now()}-${randomBytes(3).toString('hex')}`;
  const content = `${JSON.stringify(registry, null, 2)}\n`;

  try {
    writeFileSync(tempPath, content, 'utf-8');
    renameSync(tempPath, path);
  } catch (err) {
    // Clean up temp file on failure so we never leak
    if (existsSync(tempPath)) {
      try {
        rmSync(tempPath, { force: true });
      } catch {
        // swallow — the primary error is more important
      }
    }
    const msg = err instanceof Error ? err.message : String(err);
    throw new ProjectRegistryError(`Failed to write registry to ${path}: ${msg}`);
  }
}

// ============================================================================
// Mutation helpers (pure — do not touch disk)
// ============================================================================

/**
 * Adds or updates a project in the registry.
 *
 *  - If a project with the same absolute `path` already exists, update its
 *    `name` (id and registeredAt are preserved).
 *  - Otherwise create a new entry with a fresh id and the current timestamp.
 *
 * Throws {@link ProjectRegistryError} if `name` is already used by a
 * different project.
 */
export function addOrUpdateProject(
  registry: ProjectRegistry,
  input: AddProjectInput
): AddProjectResult {
  const trimmedName = input.name.trim();
  if (trimmedName.length === 0) {
    throw new ProjectRegistryError('Project name cannot be empty');
  }

  const absPath = resolve(input.path);
  const existingByPath = registry.projects.find((p) => p.path === absPath);
  const conflictingName = registry.projects.find(
    (p) => p.name === trimmedName && p.path !== absPath
  );
  if (conflictingName) {
    throw new ProjectRegistryError(
      `A different project with name "${trimmedName}" is already registered (${conflictingName.path})`
    );
  }

  if (existingByPath) {
    const updated: ProjectRegistryEntry = {
      ...existingByPath,
      name: trimmedName,
    };
    return {
      registry: {
        version: CURRENT_REGISTRY_VERSION,
        projects: registry.projects.map((p) => (p.id === existingByPath.id ? updated : p)),
      },
      entry: updated,
      added: false,
    };
  }

  const entry: ProjectRegistryEntry = {
    id: generateProjectId(registry.projects.map((p) => p.id)),
    name: trimmedName,
    path: absPath,
    registeredAt: new Date().toISOString(),
  };
  return {
    registry: {
      version: CURRENT_REGISTRY_VERSION,
      projects: [...registry.projects, entry],
    },
    entry,
    added: true,
  };
}

/** Removes a project by id. No-op when the id is unknown. */
export function removeProject(
  registry: ProjectRegistry,
  id: string
): RemoveProjectResult {
  const filtered = registry.projects.filter((p) => p.id !== id);
  return {
    registry: { version: CURRENT_REGISTRY_VERSION, projects: filtered },
    removed: filtered.length !== registry.projects.length,
  };
}

/** Finds a project entry by absolute path (after `resolve`). */
export function findProjectByPath(
  registry: ProjectRegistry,
  path: string
): ProjectRegistryEntry | undefined {
  const abs = resolve(path);
  return registry.projects.find((p) => p.path === abs);
}

/** Finds a project entry by id. */
export function findProjectById(
  registry: ProjectRegistry,
  id: string
): ProjectRegistryEntry | undefined {
  return registry.projects.find((p) => p.id === id);
}

// ============================================================================
// Internal helpers
// ============================================================================

function generateProjectId(existingIds: string[]): string {
  const taken = new Set(existingIds);
  // The namespace is large (16^8 = ~4.3B); collisions should be vanishingly
  // rare, but we loop defensively a few times for determinism in tests.
  for (let attempt = 0; attempt < 10; attempt++) {
    const candidate = `${PROJECT_ID_PREFIX}${randomBytes(PROJECT_ID_BYTES).toString('hex')}`;
    if (!taken.has(candidate)) {
      return candidate;
    }
  }
  throw new ProjectRegistryError('Could not generate a unique project id after 10 attempts');
}

function isRegistryLike(value: unknown): value is { version: unknown; projects: unknown[] } {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const obj = value as Record<string, unknown>;
  return 'version' in obj && Array.isArray(obj.projects);
}

function toEntry(raw: unknown): ProjectRegistryEntry {
  if (typeof raw !== 'object' || raw === null) {
    throw new ProjectRegistryError(`Invalid project entry: ${JSON.stringify(raw)}`);
  }
  const obj = raw as Record<string, unknown>;
  const id = typeof obj.id === 'string' ? obj.id : undefined;
  const name = typeof obj.name === 'string' ? obj.name : undefined;
  const path = typeof obj.path === 'string' ? obj.path : undefined;
  const registeredAt = typeof obj.registeredAt === 'string' ? obj.registeredAt : undefined;
  if (!id || !name || !path || !registeredAt) {
    throw new ProjectRegistryError(
      `Project entry missing required fields (id, name, path, registeredAt): ${JSON.stringify(raw)}`
    );
  }
  return { id, name, path, registeredAt };
}
