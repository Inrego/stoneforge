/**
 * Tests for project-id-util.
 *
 * Exercises the three cases route handlers care about:
 *   1. Absent — pass through without touching the filter/update
 *   2. Explicit null — detach / return unassigned only
 *   3. Valid id — scope to a single project
 * and the error path for malformed values.
 */

import { describe, test, expect } from 'bun:test';
import { parseProjectIdFromBody, parseProjectIdFromQuery } from './project-id-util.js';

describe('parseProjectIdFromBody', () => {
  test('returns undefined when body is not an object', () => {
    const result = parseProjectIdFromBody(null);
    expect(result).toEqual({ ok: true, projectId: undefined });
  });

  test('returns undefined when projectId key is absent', () => {
    const result = parseProjectIdFromBody({ name: 'foo' });
    expect(result).toEqual({ ok: true, projectId: undefined });
  });

  test('returns null when projectId is explicitly null (detach)', () => {
    const result = parseProjectIdFromBody({ projectId: null });
    expect(result).toEqual({ ok: true, projectId: null });
  });

  test('accepts a well-formed project id', () => {
    const result = parseProjectIdFromBody({ projectId: 'el-abc123' });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.projectId).toBe('el-abc123' as unknown as typeof result.projectId);
    }
  });

  test('rejects malformed project id with a validation error', () => {
    const result = parseProjectIdFromBody({ projectId: 'not-an-id' });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toMatch(/valid project ID/);
    }
  });

  test('rejects non-string project id', () => {
    const result = parseProjectIdFromBody({ projectId: 42 });
    expect(result.ok).toBe(false);
  });
});

describe('parseProjectIdFromQuery', () => {
  test('absent param means span all projects', () => {
    const params = new URLSearchParams('');
    const result = parseProjectIdFromQuery(params);
    expect(result).toEqual({ ok: true, projectId: undefined });
  });

  test('empty string means unassigned only', () => {
    const params = new URLSearchParams('projectId=');
    const result = parseProjectIdFromQuery(params);
    expect(result).toEqual({ ok: true, projectId: null });
  });

  test('"null" literal means unassigned only', () => {
    const params = new URLSearchParams('projectId=null');
    const result = parseProjectIdFromQuery(params);
    expect(result).toEqual({ ok: true, projectId: null });
  });

  test('valid id scopes to a single project', () => {
    const params = new URLSearchParams('projectId=el-xyz789');
    const result = parseProjectIdFromQuery(params);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.projectId).toBe('el-xyz789' as unknown as typeof result.projectId);
    }
  });

  test('malformed id returns a validation error', () => {
    const params = new URLSearchParams('projectId=BAD');
    const result = parseProjectIdFromQuery(params);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toMatch(/Invalid projectId/);
    }
  });
});
