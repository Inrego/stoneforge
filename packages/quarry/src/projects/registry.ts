/**
 * Projects Registry — pure module
 *
 * Manages the global `~/.stoneforge/projects.json` file, which records the
 * set of Stoneforge workspaces known to the local machine. This module is
 * intentionally I/O-boundary-only: path validation, atomic read/write, and
 * pure CRUD helpers over an in-memory `ProjectRegistry` value.
 *
 * Disk layout (v1):
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
 * Project IDs use the `proj-` prefix to stay out of the `el-` namespace
 * used by the core element system. A richer Project element type arrives
 * in a downstream task (el-1zb).
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
export const CURRENT_REGISTRY_VERSION = 1 as const;

const PROJECT_ID_PREFIX = 'proj-';
const PROJECT_ID_BYTES = 4; // 8 hex chars, collision-safe for the registry
const GITDIR_POINTER_PREFIX = 'gitdir:';
const GIT_MARKER = '.git';

// ============================================================================
// Types
// ============================================================================

export interface Project {
  /** Short identifier (proj-xxxxxxxx) used by the registry and CLI. */
  id: string;
  /** Human-readable name. Unique within the registry. */
  name: string;
  /** Absolute filesystem path to the project root. */
  path: string;
  /** ISO timestamp of first registration (unchanged by updates). */
  registeredAt: string;
}

export interface ProjectRegistry {
  version: typeof CURRENT_REGISTRY_VERSION;
  projects: Project[];
}

export interface CreateProjectInput {
  path: string;
  name: string;
}

export interface UpdateProjectInput {
  name?: string;
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

/** Absolute path to the global `~/.stoneforge` directory. */
export function getGlobalStoneforgeDir(): string {
  return join(homedir(), GLOBAL_STONEFORGE_DIR);
}

/** Absolute path to the projects registry file. */
export function getRegistryPath(): string {
  return join(getGlobalStoneforgeDir(), PROJECTS_REGISTRY_FILE);
}

// ============================================================================
// Validation
// ============================================================================

/**
 * Validates that `projectRoot` exists and looks like a git repository.
 *
 * A git repo is recognized by:
 *   1. `<root>/.git` as a directory (standard clone), OR
 *   2. `<root>/.git` as a file whose first line starts with `gitdir:`
 *      (worktree or submodule pointer).
 *
 * Throws {@link ProjectPathError} on any failure. The check is filesystem
 * only — no `git` subprocess — so it is synchronous and test-friendly.
 */
export function validateProjectPath(projectRoot: string): void {
  const abs = resolve(projectRoot);

  if (!existsSync(abs)) {
    throw new ProjectPathError(`Path does not exist: ${abs}`);
  }
  if (!statSync(abs).isDirectory()) {
    throw new ProjectPathError(`Path is not a directory: ${abs}`);
  }

  const gitPath = join(abs, GIT_MARKER);
  if (!existsSync(gitPath)) {
    throw new ProjectPathError(`Not a git repository (missing .git): ${abs}`);
  }

  const gitStat = statSync(gitPath);
  if (gitStat.isDirectory()) {
    return;
  }
  if (gitStat.isFile() && isGitdirPointerFile(gitPath)) {
    return;
  }
  throw new ProjectPathError(`Not a git repository (invalid .git at ${abs})`);
}

/** Reads `.git` as a file and checks it opens with a `gitdir:` pointer. */
function isGitdirPointerFile(gitFilePath: string): boolean {
  try {
    const content = readFileSync(gitFilePath, 'utf-8');
    const firstLine = content.split(/\r?\n/, 1)[0] ?? '';
    return firstLine.trim().startsWith(GITDIR_POINTER_PREFIX);
  } catch {
    return false;
  }
}

// ============================================================================
// Read / Write
// ============================================================================

/**
 * Reads the registry from disk. Returns an empty v1 registry when the file
 * does not exist.
 *
 * Throws {@link ProjectRegistryError} on malformed JSON, unsupported
 * version, or structurally invalid content.
 */
export function readRegistry(path: string = getRegistryPath()): ProjectRegistry {
  if (!existsSync(path)) {
    return emptyRegistry();
  }

  const raw = readRegistryFile(path);
  const parsed = parseRegistryJson(raw, path);
  assertRegistryShape(parsed, path);
  assertRegistryVersion(parsed, path);

  return {
    version: CURRENT_REGISTRY_VERSION,
    projects: parsed.projects.map(toProject),
  };
}

/**
 * Writes the registry using a temp-file + rename pattern. Crash-safe on
 * a clean throw (the temp file is unlinked); a mid-write process kill
 * may leave a `*.tmp-*` sibling on disk, which is harmless. Creates
 * parent directories as needed.
 *
 * Throws {@link ProjectRegistryError} if disk I/O fails.
 */
export function writeRegistry(path: string, registry: ProjectRegistry): void {
  ensureParentDir(path);

  const tempPath = `${path}.tmp-${Date.now()}-${randomBytes(3).toString('hex')}`;
  const content = `${JSON.stringify(registry, null, 2)}\n`;

  try {
    writeFileSync(tempPath, content, 'utf-8');
    renameSync(tempPath, path);
  } catch (err) {
    cleanupTempFile(tempPath);
    const msg = err instanceof Error ? err.message : String(err);
    throw new ProjectRegistryError(`Failed to write registry to ${path}: ${msg}`);
  }
}

// ============================================================================
// Pure CRUD helpers (no disk access)
// ============================================================================

/**
 * Returns a new registry with `input` added as a fresh project entry.
 *
 * Throws {@link ProjectRegistryError} if:
 *   - name is empty,
 *   - the absolute path is already registered, or
 *   - the name collides with a different project.
 */
export function addProject(
  registry: ProjectRegistry,
  input: CreateProjectInput
): { registry: ProjectRegistry; entry: Project } {
  const name = input.name.trim();
  const absPath = resolve(input.path);

  assertNonEmptyName(name);
  assertPathNotRegistered(registry, absPath);
  assertNameAvailable(registry, name);

  const entry: Project = {
    id: generateProjectId(registry.projects.map((p) => p.id)),
    name,
    path: absPath,
    registeredAt: new Date().toISOString(),
  };
  return {
    registry: {
      version: CURRENT_REGISTRY_VERSION,
      projects: [...registry.projects, entry],
    },
    entry,
  };
}

/**
 * Returns a new registry with the entry at `id` patched. Currently only
 * `name` is mutable (id/path/registeredAt are treated as stable keys).
 *
 * Throws {@link ProjectRegistryError} when `id` is unknown or when the new
 * name collides with a different project.
 */
export function updateProject(
  registry: ProjectRegistry,
  id: string,
  patch: UpdateProjectInput
): { registry: ProjectRegistry; entry: Project } {
  const existing = findProjectById(registry, id);
  if (!existing) {
    throw new ProjectRegistryError(`No project with id "${id}"`);
  }
  const nextName = patch.name === undefined ? existing.name : patch.name.trim();
  assertNonEmptyName(nextName);
  if (nextName.toLowerCase() !== existing.name.toLowerCase()) {
    assertNameAvailable(registry, nextName);
  }
  const updated: Project = { ...existing, name: nextName };
  return {
    registry: {
      version: CURRENT_REGISTRY_VERSION,
      projects: registry.projects.map((p) => (p.id === id ? updated : p)),
    },
    entry: updated,
  };
}

/** Returns a new registry with the entry at `id` removed. */
export function removeProject(
  registry: ProjectRegistry,
  id: string
): { registry: ProjectRegistry; removed: boolean } {
  const filtered = registry.projects.filter((p) => p.id !== id);
  return {
    registry: { version: CURRENT_REGISTRY_VERSION, projects: filtered },
    removed: filtered.length !== registry.projects.length,
  };
}

/** Finds a project by id, or undefined. */
export function findProjectById(registry: ProjectRegistry, id: string): Project | undefined {
  return registry.projects.find((p) => p.id === id);
}

/** Finds a project by absolute path (after `resolve`), or undefined. */
export function findProjectByPath(registry: ProjectRegistry, path: string): Project | undefined {
  const abs = resolve(path);
  return registry.projects.find((p) => p.path === abs);
}

/** Returns an empty v1 registry. Useful as a default for callers. */
export function emptyRegistry(): ProjectRegistry {
  return { version: CURRENT_REGISTRY_VERSION, projects: [] };
}

// ============================================================================
// Internal helpers — read/write
// ============================================================================

function readRegistryFile(path: string): string {
  try {
    return readFileSync(path, 'utf-8');
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new ProjectRegistryError(`Failed to read registry at ${path}: ${msg}`);
  }
}

function parseRegistryJson(raw: string, path: string): unknown {
  try {
    return JSON.parse(raw);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new ProjectRegistryError(`Malformed JSON in registry at ${path}: ${msg}`);
  }
}

function assertRegistryShape(
  value: unknown,
  path: string
): asserts value is { version: unknown; projects: unknown[] } {
  if (
    typeof value !== 'object' ||
    value === null ||
    !('version' in value) ||
    !Array.isArray((value as { projects?: unknown }).projects)
  ) {
    throw new ProjectRegistryError(`Registry at ${path} is not a valid registry object`);
  }
}

function assertRegistryVersion(value: { version: unknown }, path: string): void {
  if (value.version !== CURRENT_REGISTRY_VERSION) {
    throw new ProjectRegistryError(
      `Unsupported registry version ${String(value.version)} at ${path} (expected ${CURRENT_REGISTRY_VERSION})`
    );
  }
}

function toProject(raw: unknown): Project {
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

function ensureParentDir(filePath: string): void {
  const dir = dirname(filePath);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
}

function cleanupTempFile(tempPath: string): void {
  if (!existsSync(tempPath)) return;
  try {
    rmSync(tempPath, { force: true });
  } catch {
    // Swallow — the primary I/O error is more important.
  }
}

// ============================================================================
// Internal helpers — CRUD invariants
// ============================================================================

function assertNonEmptyName(name: string): void {
  if (name.length === 0) {
    throw new ProjectRegistryError('Project name cannot be empty');
  }
}

function assertPathNotRegistered(registry: ProjectRegistry, absPath: string): void {
  const existing = registry.projects.find((p) => p.path === absPath);
  if (existing) {
    throw new ProjectRegistryError(
      `Path is already registered as "${existing.name}" (${existing.id})`
    );
  }
}

function assertNameAvailable(registry: ProjectRegistry, name: string): void {
  // Case-insensitive to match user expectations on case-preserving filesystems
  // (Windows/macOS default). The display name stored on disk preserves the
  // caller's casing.
  const needle = name.toLowerCase();
  const clash = registry.projects.find((p) => p.name.toLowerCase() === needle);
  if (clash) {
    throw new ProjectRegistryError(
      `A project with name "${name}" is already registered (${clash.path})`
    );
  }
}

function generateProjectId(existingIds: string[]): string {
  const taken = new Set(existingIds);
  for (let attempt = 0; attempt < 10; attempt++) {
    const candidate = `${PROJECT_ID_PREFIX}${randomBytes(PROJECT_ID_BYTES).toString('hex')}`;
    if (!taken.has(candidate)) {
      return candidate;
    }
  }
  throw new ProjectRegistryError('Could not generate a unique project id after 10 attempts');
}
