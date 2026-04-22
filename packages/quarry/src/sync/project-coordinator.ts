/**
 * Project Sync Coordinator
 *
 * Runs one {@link AutoExportService} per registered project, each pinned to
 * its own `projectId` scope and routed to `{project.path}/.stoneforge/`.
 * This is the public surface of per-project JSONL sync: each project gets a
 * private sync stream whose JSONL files live inside the project's own git
 * tree, so the project stays portable.
 *
 * The coordinator does not replace the backend-level sync service — it
 * composes many {@link AutoExportService} instances on top of a single
 * shared backend and sync service. A single SQLite cache still powers
 * everything; only the JSONL output is sharded.
 *
 * Lifecycle:
 *   - `start()`  — reads the project registry and spins up one stream per
 *                  project. Idempotent.
 *   - `reload()` — reconciles running streams against the current registry
 *                  (new projects get started, removed ones get stopped).
 *   - `stop()`   — stops every stream and clears internal state.
 */

import { join } from 'node:path';
import type { StorageBackend } from '@stoneforge/storage';
import type { SyncConfig } from '../config/types.js';
import type { Project } from '../projects/registry.js';
import type { ProjectRegistryService } from '../projects/service.js';
import { AutoExportService, createAutoExportService } from './auto-export.js';
import type { SyncService } from './service.js';

/**
 * Name of the per-project sync directory, relative to the project root.
 * Exported so tests and ops tooling can reference the same constant.
 */
export const PROJECT_SYNC_DIRNAME = '.stoneforge';

export interface ProjectSyncCoordinatorOptions {
  syncService: SyncService;
  backend: StorageBackend;
  syncConfig: SyncConfig;
  projectsService: ProjectRegistryService;
}

/**
 * Factory hook for tests that want to swap in a stubbed `AutoExportService`
 * without mocking the whole module. Production code never sets this.
 */
export type AutoExportFactory = typeof createAutoExportService;

/**
 * One-stream-per-project coordinator.
 */
export class ProjectSyncCoordinator {
  private readonly syncService: SyncService;
  private readonly backend: StorageBackend;
  private readonly syncConfig: SyncConfig;
  private readonly projectsService: ProjectRegistryService;
  private readonly factory: AutoExportFactory;
  /** Running streams keyed by projectId. */
  private readonly streams = new Map<string, AutoExportService>();
  private started = false;

  constructor(
    options: ProjectSyncCoordinatorOptions,
    factory: AutoExportFactory = createAutoExportService
  ) {
    this.syncService = options.syncService;
    this.backend = options.backend;
    this.syncConfig = options.syncConfig;
    this.projectsService = options.projectsService;
    this.factory = factory;
  }

  /**
   * Start one {@link AutoExportService} for each currently-registered
   * project. Idempotent: calling twice does nothing the second time, and
   * leaves the first-call streams intact.
   */
  async start(): Promise<void> {
    if (this.started) return;
    this.started = true;

    const projects = this.projectsService.list();
    await Promise.all(projects.map((p) => this.startStream(p)));
  }

  /**
   * Reconcile the set of running streams with the current registry.
   *
   * - New projects get a new stream started.
   * - Removed projects have their stream stopped.
   * - Existing projects are left alone (no restart — restarting triggers a
   *   full export, which is expensive).
   *
   * Safe to call before `start()`; it just becomes the initial start.
   */
  async reload(): Promise<void> {
    // Delegate to start on the first call so we don't duplicate boot logic.
    if (!this.started) {
      await this.start();
      return;
    }

    const projects = this.projectsService.list();
    const nextIds = new Set(projects.map((p) => p.id));

    // Stop streams whose project is no longer registered.
    for (const [projectId, stream] of this.streams) {
      if (!nextIds.has(projectId)) {
        stream.stop();
        this.streams.delete(projectId);
      }
    }

    // Start streams for projects we haven't seen yet.
    const starts: Promise<void>[] = [];
    for (const project of projects) {
      if (!this.streams.has(project.id)) {
        starts.push(this.startStream(project));
      }
    }
    await Promise.all(starts);
  }

  /**
   * Stop every stream. Idempotent. Leaves the coordinator ready to be
   * started again, though in practice it is a boot-time singleton.
   */
  stop(): void {
    for (const stream of this.streams.values()) {
      stream.stop();
    }
    this.streams.clear();
    this.started = false;
  }

  /**
   * Snapshot of the projects currently backed by a running stream. Useful
   * for diagnostics and for tests that verify lifecycle transitions.
   */
  getActiveProjectIds(): string[] {
    return [...this.streams.keys()];
  }

  /** Absolute output directory used for a given project. */
  static outputDirFor(project: Pick<Project, 'path'>): string {
    return join(project.path, PROJECT_SYNC_DIRNAME);
  }

  // --------------------------------------------------------------------------
  // Internals
  // --------------------------------------------------------------------------

  private async startStream(project: Project): Promise<void> {
    if (this.streams.has(project.id)) return;

    const service = this.factory({
      syncService: this.syncService,
      backend: this.backend,
      syncConfig: this.syncConfig,
      outputDir: ProjectSyncCoordinator.outputDirFor(project),
      projectId: project.id,
      label: project.name,
    });

    this.streams.set(project.id, service);

    try {
      await service.start();
    } catch (err) {
      // Don't let a single bad project take down the whole coordinator.
      // The failure is logged; other streams keep running.
      console.error(
        `[project-sync] Failed to start stream for project "${project.name}" (${project.id}):`,
        err
      );
    }
  }
}

/**
 * Create a new {@link ProjectSyncCoordinator}. The factory form matches the
 * rest of the sync module (`createSyncService`, `createAutoExportService`)
 * so callers can stay stylistically consistent.
 */
export function createProjectSyncCoordinator(
  options: ProjectSyncCoordinatorOptions,
  factory?: AutoExportFactory
): ProjectSyncCoordinator {
  return new ProjectSyncCoordinator(options, factory);
}
