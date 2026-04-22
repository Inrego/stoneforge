/**
 * Project Type - Workspace / codebase primitive
 *
 * A Project represents a distinct workspace (typically a directory on disk) whose
 * elements (tasks, plans, documents, messages, ...) are scoped together. The Project
 * element is the durable record of a registered project; a foreign-key style
 * `projectId` on other elements associates them with it.
 *
 * Fields (minimal for migration phase):
 *  - id: branded ElementId
 *  - name: human-readable display name
 *  - path: absolute filesystem path to the project root
 */

import { ValidationError } from '../errors/error.js';
import { ErrorCode } from '../errors/codes.js';
import {
  Element,
  ElementId,
  EntityId,
  ElementType,
  Timestamp,
  createTimestamp,
  validateTags,
  validateMetadata,
  ProjectId,
  asProjectId,
  isValidProjectId,
  validateProjectId,
} from './element.js';
import { generateId, type IdGeneratorConfig } from '../id/generator.js';

// Re-export ProjectId surface for existing consumers of './project.js'.
export type { ProjectId };
export { asProjectId, isValidProjectId, validateProjectId };

// ============================================================================
// Validation Constants
// ============================================================================

/** Minimum project name length */
export const MIN_PROJECT_NAME_LENGTH = 1;

/** Maximum project name length */
export const MAX_PROJECT_NAME_LENGTH = 100;

/** Maximum project path length */
export const MAX_PROJECT_PATH_LENGTH = 4096;

// ============================================================================
// Project Interface
// ============================================================================

/**
 * Project interface - extends Element with workspace identification.
 */
export interface Project extends Element {
  /** Project type is always 'project' */
  readonly type: typeof ElementType.PROJECT;

  /** Human-readable project name (1-100 characters) */
  name: string;
  /** Absolute filesystem path to the project root */
  path: string;
}

// ============================================================================
// Validation Functions
// ============================================================================

/**
 * Validates a project name
 */
export function isValidProjectName(value: unknown): value is string {
  if (typeof value !== 'string') {
    return false;
  }
  const trimmed = value.trim();
  return (
    trimmed.length >= MIN_PROJECT_NAME_LENGTH && trimmed.length <= MAX_PROJECT_NAME_LENGTH
  );
}

/**
 * Validates project name and throws if invalid
 */
export function validateProjectName(value: unknown): string {
  if (typeof value !== 'string') {
    throw new ValidationError(
      'Project name must be a string',
      ErrorCode.INVALID_INPUT,
      { field: 'name', value, expected: 'string' }
    );
  }

  const trimmed = value.trim();
  if (trimmed.length === 0) {
    throw new ValidationError(
      'Project name cannot be empty',
      ErrorCode.MISSING_REQUIRED_FIELD,
      { field: 'name', value }
    );
  }

  if (trimmed.length > MAX_PROJECT_NAME_LENGTH) {
    throw new ValidationError(
      `Project name exceeds maximum length of ${MAX_PROJECT_NAME_LENGTH} characters`,
      ErrorCode.INVALID_INPUT,
      {
        field: 'name',
        expected: `<= ${MAX_PROJECT_NAME_LENGTH} characters`,
        actual: trimmed.length,
      }
    );
  }

  return trimmed;
}

/**
 * Validates a project path. Paths are intentionally loose: we accept any
 * non-empty string (trimmed), capped at MAX_PROJECT_PATH_LENGTH. OS-specific
 * canonicalization and existence checks happen at higher layers.
 */
export function isValidProjectPath(value: unknown): value is string {
  if (typeof value !== 'string') {
    return false;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 && trimmed.length <= MAX_PROJECT_PATH_LENGTH;
}

/**
 * Validates project path and throws if invalid
 */
export function validateProjectPath(value: unknown): string {
  if (typeof value !== 'string') {
    throw new ValidationError(
      'Project path must be a string',
      ErrorCode.INVALID_INPUT,
      { field: 'path', value, expected: 'string' }
    );
  }

  const trimmed = value.trim();
  if (trimmed.length === 0) {
    throw new ValidationError(
      'Project path cannot be empty',
      ErrorCode.MISSING_REQUIRED_FIELD,
      { field: 'path', value }
    );
  }

  if (trimmed.length > MAX_PROJECT_PATH_LENGTH) {
    throw new ValidationError(
      `Project path exceeds maximum length of ${MAX_PROJECT_PATH_LENGTH} characters`,
      ErrorCode.INVALID_INPUT,
      {
        field: 'path',
        expected: `<= ${MAX_PROJECT_PATH_LENGTH} characters`,
        actual: trimmed.length,
      }
    );
  }

  return trimmed;
}

// ============================================================================
// Type Guards
// ============================================================================

/**
 * Type guard to check if a value is a valid Project
 */
export function isProject(value: unknown): value is Project {
  if (typeof value !== 'object' || value === null) {
    return false;
  }

  const obj = value as Record<string, unknown>;

  if (typeof obj.id !== 'string') return false;
  if (obj.type !== ElementType.PROJECT) return false;
  if (typeof obj.createdAt !== 'string') return false;
  if (typeof obj.updatedAt !== 'string') return false;
  if (typeof obj.createdBy !== 'string') return false;
  if (!Array.isArray(obj.tags)) return false;
  if (typeof obj.metadata !== 'object' || obj.metadata === null) return false;

  if (!isValidProjectName(obj.name)) return false;
  if (!isValidProjectPath(obj.path)) return false;

  return true;
}

/**
 * Comprehensive validation of a project with detailed errors
 */
export function validateProject(value: unknown): Project {
  if (typeof value !== 'object' || value === null) {
    throw new ValidationError('Project must be an object', ErrorCode.INVALID_INPUT, {
      value,
    });
  }

  const obj = value as Record<string, unknown>;

  if (typeof obj.id !== 'string' || obj.id.length === 0) {
    throw new ValidationError(
      'Project id is required and must be a non-empty string',
      ErrorCode.MISSING_REQUIRED_FIELD,
      { field: 'id', value: obj.id }
    );
  }

  if (obj.type !== ElementType.PROJECT) {
    throw new ValidationError(
      `Project type must be '${ElementType.PROJECT}'`,
      ErrorCode.INVALID_INPUT,
      { field: 'type', value: obj.type, expected: ElementType.PROJECT }
    );
  }

  if (typeof obj.createdAt !== 'string') {
    throw new ValidationError(
      'Project createdAt is required',
      ErrorCode.MISSING_REQUIRED_FIELD,
      { field: 'createdAt', value: obj.createdAt }
    );
  }

  if (typeof obj.updatedAt !== 'string') {
    throw new ValidationError(
      'Project updatedAt is required',
      ErrorCode.MISSING_REQUIRED_FIELD,
      { field: 'updatedAt', value: obj.updatedAt }
    );
  }

  if (typeof obj.createdBy !== 'string' || obj.createdBy.length === 0) {
    throw new ValidationError(
      'Project createdBy is required and must be a non-empty string',
      ErrorCode.MISSING_REQUIRED_FIELD,
      { field: 'createdBy', value: obj.createdBy }
    );
  }

  if (!Array.isArray(obj.tags)) {
    throw new ValidationError('Project tags must be an array', ErrorCode.INVALID_INPUT, {
      field: 'tags',
      value: obj.tags,
      expected: 'array',
    });
  }

  if (typeof obj.metadata !== 'object' || obj.metadata === null || Array.isArray(obj.metadata)) {
    throw new ValidationError('Project metadata must be an object', ErrorCode.INVALID_INPUT, {
      field: 'metadata',
      value: obj.metadata,
      expected: 'object',
    });
  }

  validateProjectName(obj.name);
  validateProjectPath(obj.path);

  return value as Project;
}

// ============================================================================
// Factory
// ============================================================================

/**
 * Input for creating a new project
 */
export interface CreateProjectInput {
  /** Human-readable project name (1-100 characters) */
  name: string;
  /** Absolute filesystem path to the project root */
  path: string;
  /** Entity creating the project */
  createdBy: EntityId;
  /** Optional: tags */
  tags?: string[];
  /** Optional: metadata */
  metadata?: Record<string, unknown>;
}

/**
 * Creates a new Project with validated inputs.
 *
 * The ID is derived from (name + path) to reduce the chance of two imports of
 * the same directory producing different IDs.
 */
export async function createProject(
  input: CreateProjectInput,
  config?: IdGeneratorConfig
): Promise<Project> {
  const name = validateProjectName(input.name);
  const path = validateProjectPath(input.path);

  const tags = input.tags ? validateTags(input.tags) : [];
  const metadata = input.metadata ? validateMetadata(input.metadata) : {};

  const now: Timestamp = createTimestamp();

  // Use name + path so different projects with identical names still produce
  // distinct, stable IDs.
  const id = await generateId(
    { identifier: `${name} ${path}`, createdBy: input.createdBy },
    config
  );

  const project: Project = {
    id,
    type: ElementType.PROJECT,
    createdAt: now,
    updatedAt: now,
    createdBy: input.createdBy,
    tags,
    metadata,
    name,
    path,
  };

  return project;
}

// ============================================================================
// Updates
// ============================================================================

/**
 * Input for updating a project
 */
export interface UpdateProjectInput {
  /** New name (optional) */
  name?: string;
  /** New filesystem path (optional) */
  path?: string;
}

/**
 * Updates a project with new values. Returns a new project object; ID is
 * preserved.
 */
export function updateProject(project: Project, input: UpdateProjectInput): Project {
  const updates: Partial<Project> = {
    updatedAt: createTimestamp(),
  };

  if (input.name !== undefined) {
    updates.name = validateProjectName(input.name);
  }
  if (input.path !== undefined) {
    updates.path = validateProjectPath(input.path);
  }

  return { ...project, ...updates };
}

// ============================================================================
// Utility Functions
// ============================================================================

/**
 * Display string for a project.
 */
export function getProjectDisplayName(project: Project): string {
  return project.name;
}

/**
 * Find a project by absolute path (case-sensitive exact match after trim).
 */
export function findByPath<T extends Project>(projects: T[], path: string): T | undefined {
  const trimmed = path.trim();
  return projects.find((p) => p.path === trimmed);
}

/**
 * Find a project by name (case-insensitive exact match).
 */
export function findByName<T extends Project>(projects: T[], name: string): T | undefined {
  const lowerName = name.toLowerCase();
  return projects.find((p) => p.name.toLowerCase() === lowerName);
}

/**
 * Sort projects by name (alphabetically, ascending by default).
 */
export function sortByName<T extends Project>(projects: T[], ascending = true): T[] {
  return [...projects].sort((a, b) => {
    const cmp = a.name.localeCompare(b.name);
    return ascending ? cmp : -cmp;
  });
}
