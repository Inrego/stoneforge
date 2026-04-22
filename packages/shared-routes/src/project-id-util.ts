/**
 * Small helpers used by route handlers to thread `projectId` through
 * create, update, and list endpoints.
 *
 * All functions validate the shape of a project ID without performing a
 * database lookup — existence checks happen at the storage layer (or are
 * deliberately skipped while multi-project support is rolling out). Keeping
 * this module tiny lets every route file stay self-contained and readable.
 */

import { isValidProjectId, type ProjectId } from '@stoneforge/core';

/**
 * Outcome of parsing a projectId supplied on a create/update request body.
 *
 *  - `{ ok: true, projectId }` — a valid project id was supplied.
 *  - `{ ok: true, projectId: null }` — the caller explicitly set `projectId: null`
 *    to detach an element from any project.
 *  - `{ ok: true, projectId: undefined }` — the caller did not mention
 *    `projectId`; callers should leave the element's current association
 *    unchanged.
 *  - `{ ok: false, error }` — the supplied value was not a valid project id.
 */
export type ProjectIdBodyResult =
  | { ok: true; projectId: ProjectId | null | undefined }
  | { ok: false; error: string };

/**
 * Parse `projectId` from a JSON request body. The caller decides whether a
 * missing value is acceptable (e.g. optional on mutate routes, required on
 * create routes).
 */
export function parseProjectIdFromBody(body: unknown): ProjectIdBodyResult {
  if (typeof body !== 'object' || body === null) {
    return { ok: true, projectId: undefined };
  }
  const record = body as Record<string, unknown>;
  if (!('projectId' in record)) {
    return { ok: true, projectId: undefined };
  }
  const raw = record.projectId;
  if (raw === null) {
    return { ok: true, projectId: null };
  }
  if (raw === undefined) {
    return { ok: true, projectId: undefined };
  }
  if (isValidProjectId(raw)) {
    return { ok: true, projectId: raw };
  }
  return { ok: false, error: 'projectId must be a valid project ID (e.g. "el-xxx") or null' };
}

/**
 * Outcome of parsing `?projectId=` from a URL. `undefined` means the query
 * parameter was absent — list routes should span all projects in that case.
 */
export type ProjectIdQueryResult =
  | { ok: true; projectId: ProjectId | null | undefined }
  | { ok: false; error: string };

/**
 * Parse `?projectId=` from a URL's search parameters.
 *
 *  - Absent → undefined (no filter; span all projects).
 *  - Empty string or the literal "null" → null (elements with no project).
 *  - Otherwise must be a valid project id.
 */
export function parseProjectIdFromQuery(searchParams: URLSearchParams): ProjectIdQueryResult {
  if (!searchParams.has('projectId')) {
    return { ok: true, projectId: undefined };
  }
  const raw = searchParams.get('projectId');
  if (raw === null || raw === '' || raw === 'null') {
    return { ok: true, projectId: null };
  }
  if (isValidProjectId(raw)) {
    return { ok: true, projectId: raw };
  }
  return { ok: false, error: `Invalid projectId query parameter: ${raw}` };
}
