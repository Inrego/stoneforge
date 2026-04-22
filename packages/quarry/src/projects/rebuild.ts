/**
 * Global SQLite cache rebuild
 *
 * Rebuilds `~/.stoneforge/stoneforge.db` from the JSONL source-of-truth files
 * of every project listed in the registry. The global DB is *disposable* —
 * it is always rebuilt from scratch so its contents cannot drift from the
 * union of the per-project JSONL files.
 *
 * Multi-project element-ID collisions are handled by the existing sync merge
 * strategy (import-order, last-writer-wins). A richer reconciliation story
 * (projectId scoping, cross-project conflict surfacing) belongs to el-1zb
 * once the Project element type exists.
 */

import { existsSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import {
  createStorage,
  EXPECTED_TABLES,
  initializeSchema,
  type StorageBackend,
} from '@stoneforge/storage';
import { createSyncService } from '../sync/service.js';
import { validateProjectPath, type ProjectRegistryEntry } from './registry.js';

// ============================================================================
// Types
// ============================================================================

export interface RebuildInput {
  /** Absolute path to the global SQLite DB to rebuild. */
  dbPath: string;
  /** Registered projects whose JSONL should be imported. */
  projects: ProjectRegistryEntry[];
}

export interface SkippedProject {
  id: string;
  name: string;
  path: string;
  reason: string;
}

export interface RebuildResult {
  /** DB path that was (re)built. */
  dbPath: string;
  /** Projects successfully imported. */
  projectsImported: number;
  /** Projects skipped (path missing or invalid). */
  projectsSkipped: number;
  /** Total elements imported across all projects. */
  totalElementsImported: number;
  /** Total dependencies imported across all projects. */
  totalDependenciesImported: number;
  /** Detailed skip records for reporting. */
  skipped: SkippedProject[];
}

// ============================================================================
// Rebuild
// ============================================================================

/**
 * Wipes all data from the global DB, reinitializes the schema, and imports
 * every registered project's JSONL sync directory.
 *
 * Rather than deleting the DB file (which races with SQLite's file locks on
 * Windows), we open the existing file and clear every table. The schema is
 * then (re)initialized — `initializeSchema` is idempotent — and projects are
 * imported in registry order via the existing sync merge pipeline.
 *
 * The operation is idempotent: re-running it produces the same DB state,
 * modulo ordering when two projects share an element id (last-writer-wins
 * by registry order).
 */
export function rebuildGlobalCache(input: RebuildInput): RebuildResult {
  ensureParentDir(input.dbPath);

  const backend = createStorage({ path: input.dbPath, create: true });
  try {
    clearAllTables(backend);
    initializeSchema(backend);

    const syncService = createSyncService(backend);
    const skipped: SkippedProject[] = [];
    let projectsImported = 0;
    let totalElementsImported = 0;
    let totalDependenciesImported = 0;

    for (const project of input.projects) {
      const skipReason = reasonToSkip(project);
      if (skipReason) {
        skipped.push({
          id: project.id,
          name: project.name,
          path: project.path,
          reason: skipReason,
        });
        continue;
      }

      const syncDir = join(project.path, '.stoneforge', 'sync');
      const result = syncService.importSync({ inputDir: syncDir });

      projectsImported++;
      totalElementsImported += result.elementsImported;
      totalDependenciesImported += result.dependenciesImported;
    }

    return {
      dbPath: input.dbPath,
      projectsImported,
      projectsSkipped: skipped.length,
      totalElementsImported,
      totalDependenciesImported,
      skipped,
    };
  } finally {
    backend.close();
  }
}

// ============================================================================
// Helpers
// ============================================================================

function ensureParentDir(filePath: string): void {
  const parent = dirname(filePath);
  if (!existsSync(parent)) {
    mkdirSync(parent, { recursive: true });
  }
}

/**
 * Clears every known table so the DB is effectively empty, without dropping
 * the file (which can race with SQLite file locks on Windows).
 *
 * Missing tables are skipped: a brand-new file has none of them yet, and
 * `initializeSchema` will create them afterwards.
 */
function clearAllTables(backend: StorageBackend): void {
  const existing = new Set(
    backend
      .query<{ name: string }>(
        "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'"
      )
      .map((r) => r.name)
  );

  backend.transaction((tx) => {
    // Disable FKs for the truncation so child-before-parent deletes are fine.
    tx.run('PRAGMA defer_foreign_keys = ON');
    for (const table of EXPECTED_TABLES) {
      if (!existing.has(table)) continue;
      // FTS virtual tables do not support DELETE without a matching row,
      // but DELETE FROM name with no predicate is accepted by fts5.
      tx.run(`DELETE FROM ${table}`);
    }
  });
}

function reasonToSkip(project: ProjectRegistryEntry): string | null {
  try {
    validateProjectPath(project.path);
    return null;
  } catch (err) {
    return err instanceof Error ? err.message : String(err);
  }
}
