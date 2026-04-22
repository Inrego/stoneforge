/**
 * Projects Registry Service
 *
 * Thin service facade over the pure registry module in `./registry.ts`.
 * Composes disk I/O, path validation, and the CRUD helpers into the
 * create / get / list / update / remove surface consumed by the CLI and
 * the server boot hook.
 *
 * The service caches the last-read registry in a closure so list/get are
 * cheap. Any mutating call persists to disk *before* updating the cached
 * snapshot, so an I/O failure leaves the in-memory view consistent with
 * what's on disk.
 */

import {
  addProject,
  findProjectById,
  findProjectByPath,
  getRegistryPath,
  readRegistry,
  removeProject,
  updateProject,
  validateProjectPath,
  writeRegistry,
  type CreateProjectInput,
  type Project,
  type ProjectRegistry,
  type UpdateProjectInput,
} from './registry.js';

// ============================================================================
// Types
// ============================================================================

export interface ProjectRegistryServiceOptions {
  /** Absolute path to the registry file. Defaults to `~/.stoneforge/projects.json`. */
  path?: string;
  /**
   * Skip `validateProjectPath` on create/update. Intended for tests that
   * construct registries against scratch directories without initializing
   * git. Never set this from production code.
   */
  skipPathValidation?: boolean;
}

export interface ProjectRegistryService {
  /** Absolute path to the backing JSON file. */
  readonly path: string;
  /** Creates a new project entry. Validates the path is a git repo. */
  create(input: CreateProjectInput): Project;
  /** Returns the project with `id`, or undefined. */
  get(id: string): Project | undefined;
  /** Returns the project at `path` (absolute-resolved), or undefined. */
  getByPath(path: string): Project | undefined;
  /** Returns a snapshot of all registered projects. */
  list(): Project[];
  /** Patches a project's mutable fields (currently: name). */
  update(id: string, patch: UpdateProjectInput): Project;
  /** Removes a project. Returns true if anything was removed. */
  remove(id: string): boolean;
  /** Re-reads the registry from disk, discarding the cached snapshot. */
  reload(): void;
  /** Returns the current in-memory snapshot of the registry. */
  snapshot(): ProjectRegistry;
}

// ============================================================================
// Factory
// ============================================================================

/**
 * Builds a {@link ProjectRegistryService} backed by a JSON file on disk.
 *
 * On construction the file is read eagerly. A missing file is treated as
 * an empty registry — callers do not need to initialize anything. Any
 * parse/version error is raised at construction time so boot paths fail
 * fast rather than limp along with a stale in-memory registry.
 */
export function createProjectRegistryService(
  options: ProjectRegistryServiceOptions = {}
): ProjectRegistryService {
  const path = options.path ?? getRegistryPath();
  const skipValidation = options.skipPathValidation ?? false;

  let registry: ProjectRegistry = readRegistry(path);

  function persist(next: ProjectRegistry): void {
    writeRegistry(path, next);
    registry = next;
  }

  return {
    path,
    create(input) {
      if (!skipValidation) {
        validateProjectPath(input.path);
      }
      const result = addProject(registry, input);
      persist(result.registry);
      return result.entry;
    },
    get(id) {
      return findProjectById(registry, id);
    },
    getByPath(p) {
      return findProjectByPath(registry, p);
    },
    list() {
      return [...registry.projects];
    },
    update(id, patch) {
      const result = updateProject(registry, id, patch);
      persist(result.registry);
      return result.entry;
    },
    remove(id) {
      const result = removeProject(registry, id);
      if (!result.removed) return false;
      persist(result.registry);
      return true;
    },
    reload() {
      registry = readRegistry(path);
    },
    snapshot() {
      return { version: registry.version, projects: [...registry.projects] };
    },
  };
}

/**
 * Attempts to build the registry service for server boot. Returns the
 * service on success, or `null` when the registry is unreadable. The
 * failure mode is intentionally non-fatal: a malformed or unreadable
 * registry should not keep the server from starting, but it should be
 * surfaced to the operator. The caller is expected to log the error.
 */
export function tryLoadProjectRegistryService(
  options: ProjectRegistryServiceOptions = {}
): { service: ProjectRegistryService } | { error: Error } {
  try {
    return { service: createProjectRegistryService(options) };
  } catch (err) {
    return { error: err instanceof Error ? err : new Error(String(err)) };
  }
}

/**
 * Boot-time loader used by the server. Returns the loaded service (or
 * `null` on failure) plus a pre-formatted log line for the operator.
 * Keeping this as a named helper lets the boot branch in
 * `createQuarryApp` stay a single call and makes the
 * "good file / bad file" matrix unit-testable without spinning up the
 * whole HTTP app.
 */
export function loadProjectRegistryForBoot(
  options: ProjectRegistryServiceOptions = {}
): { service: ProjectRegistryService | null; logLevel: 'info' | 'warn'; message: string } {
  const result = tryLoadProjectRegistryService(options);
  if ('service' in result) {
    const { service } = result;
    const count = service.list().length;
    return {
      service,
      logLevel: 'info',
      message: `Loaded projects registry (${count} project${count === 1 ? '' : 's'}): ${service.path}`,
    };
  }
  return {
    service: null,
    logLevel: 'warn',
    message: `Failed to load projects registry, continuing without it: ${result.error.message}`,
  };
}

