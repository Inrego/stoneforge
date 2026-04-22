/**
 * Storage System Type Definitions
 *
 * Core types for the storage abstraction layer:
 * - Query result types
 * - Transaction interfaces
 * - Configuration types
 */

import type { ElementId } from '@stoneforge/core';

// ============================================================================
// Query Result Types
// ============================================================================

/**
 * A single row result from a query
 */
export type Row = Record<string, unknown>;

/**
 * Result of a query execution containing rows
 */
export interface QueryResult<T extends Row = Row> {
  /** The rows returned by the query */
  rows: T[];
  /** Number of rows returned */
  count: number;
}

/**
 * Result of a mutation (INSERT, UPDATE, DELETE)
 */
export interface MutationResult {
  /** Number of rows affected by the mutation */
  changes: number;
  /** Last inserted row ID (for auto-increment tables) */
  lastInsertRowid?: number | bigint;
}

/**
 * Combined result type for any SQL statement
 */
export type StatementResult<T extends Row = Row> = QueryResult<T> | MutationResult;

// ============================================================================
// Prepared Statement Interface
// ============================================================================

/**
 * A prepared SQL statement that can be executed multiple times
 * with different parameters for improved performance
 */
export interface PreparedStatement<T extends Row = Row> {
  /** Execute the statement and return all matching rows */
  all(...params: unknown[]): T[];

  /** Execute the statement and return the first matching row */
  get(...params: unknown[]): T | undefined;

  /** Execute the statement for its side effects (INSERT, UPDATE, DELETE) */
  run(...params: unknown[]): MutationResult;

  /** Release resources associated with this prepared statement */
  finalize(): void;
}

// ============================================================================
// Transaction Interface
// ============================================================================

/**
 * Transaction isolation levels
 */
export type IsolationLevel = 'deferred' | 'immediate' | 'exclusive';

/**
 * Options for transaction execution
 */
export interface TransactionOptions {
  /** Isolation level for the transaction */
  isolation?: IsolationLevel;
}

/**
 * A database transaction context
 */
export interface Transaction {
  /** Execute a SQL statement within the transaction */
  exec(sql: string): void;

  /** Query with parameters and return all results */
  query<T extends Row = Row>(sql: string, params?: unknown[]): T[];

  /** Query and return single result */
  queryOne<T extends Row = Row>(sql: string, params?: unknown[]): T | undefined;

  /** Execute a mutation (INSERT, UPDATE, DELETE) */
  run(sql: string, params?: unknown[]): MutationResult;

  /** Create a savepoint for nested transaction support */
  savepoint(name: string): void;

  /** Release a savepoint (commit nested transaction) */
  release(name: string): void;

  /** Rollback to a savepoint */
  rollbackTo(name: string): void;
}

// ============================================================================
// Configuration Types
// ============================================================================

/**
 * SQLite pragma settings for database configuration
 */
export interface SqlitePragmas {
  /** Journal mode (default: WAL) */
  journal_mode?: 'delete' | 'truncate' | 'persist' | 'memory' | 'wal' | 'off';
  /** Synchronous mode (default: NORMAL) */
  synchronous?: 'off' | 'normal' | 'full' | 'extra';
  /** Foreign key enforcement (default: ON) */
  foreign_keys?: boolean;
  /** Busy timeout in milliseconds (default: 5000) */
  busy_timeout?: number;
  /** Cache size in pages (negative = KB) */
  cache_size?: number;
  /** Temp store location */
  temp_store?: 'default' | 'file' | 'memory';
}

/**
 * Configuration for storage backend initialization
 */
export interface StorageConfig {
  /** Path to the database file (or :memory: for in-memory) */
  path: string;
  /** SQLite pragma settings */
  pragmas?: SqlitePragmas;
  /** Create database if it doesn't exist (default: true) */
  create?: boolean;
  /** Open in read-only mode (default: false) */
  readonly?: boolean;
  /** Enable verbose logging (default: false) */
  verbose?: boolean;
}

/**
 * Default pragma settings optimized for Stoneforge use cases
 */
export const DEFAULT_PRAGMAS: Required<SqlitePragmas> = {
  journal_mode: 'wal',
  synchronous: 'normal',
  foreign_keys: true,
  busy_timeout: 5000,
  cache_size: -2000, // 2MB
  temp_store: 'memory',
};

// ============================================================================
// Dirty Tracking Types
// ============================================================================

/**
 * A dirty element record for incremental export
 */
export interface DirtyElement {
  /** The element ID that was modified */
  elementId: ElementId;
  /** When the element was marked dirty */
  markedAt: string;
}

/**
 * Options for dirty tracking operations
 */
export interface DirtyTrackingOptions {
  /** Whether to include element deletions */
  includeDeleted?: boolean;
  /**
   * Restrict dirty elements to a project scope:
   *   - `undefined` — no scope filter (all dirty elements, legacy behavior)
   *   - a string    — only dirty elements whose `project_id` matches
   *   - `null`      — only dirty elements with no project (`project_id IS NULL`)
   *
   * Used by per-project sync streams so one project's incremental export
   * does not clear another project's dirty markers.
   */
  projectId?: string | null;
}

/**
 * Build a SQL query for `getDirtyElements` honoring {@link DirtyTrackingOptions}.
 *
 * Shared between backend implementations to keep the filter semantics
 * identical across runtimes.
 *
 * The base query reads from `dirty_elements`. When a `projectId` filter is
 * set, the query joins `elements` on `element_id = id` and filters by
 * `elements.project_id`. This is why dirty records whose underlying element
 * no longer exists (race between delete + poll) are silently dropped under a
 * project filter — they cannot be attributed to any project.
 */
export function buildDirtyElementsQuery(
  options?: DirtyTrackingOptions
): { sql: string; params: unknown[] } {
  const projectId = options?.projectId;

  if (projectId === undefined) {
    return {
      sql: 'SELECT element_id, marked_at FROM dirty_elements ORDER BY marked_at',
      params: [],
    };
  }

  if (projectId === null) {
    return {
      sql:
        'SELECT d.element_id AS element_id, d.marked_at AS marked_at ' +
        'FROM dirty_elements d ' +
        'INNER JOIN elements e ON e.id = d.element_id ' +
        'WHERE e.project_id IS NULL ' +
        'ORDER BY d.marked_at',
      params: [],
    };
  }

  return {
    sql:
      'SELECT d.element_id AS element_id, d.marked_at AS marked_at ' +
      'FROM dirty_elements d ' +
      'INNER JOIN elements e ON e.id = d.element_id ' +
      'WHERE e.project_id = ? ' +
      'ORDER BY d.marked_at',
    params: [projectId],
  };
}

// ============================================================================
// Schema Migration Types
// ============================================================================

/**
 * A database schema migration
 */
export interface Migration {
  /** Migration version number */
  version: number;
  /** Human-readable description */
  description: string;
  /** SQL to apply the migration */
  up: string;
  /** SQL to rollback the migration (optional) */
  down?: string;
}

/**
 * Result of running migrations
 */
export interface MigrationResult {
  /** Previous schema version */
  fromVersion: number;
  /** New schema version */
  toVersion: number;
  /** Migrations that were applied */
  applied: number[];
  /** Whether any migrations were run */
  success: boolean;
}
