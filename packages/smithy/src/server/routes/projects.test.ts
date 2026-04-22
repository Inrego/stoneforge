/**
 * Project Routes Tests
 *
 * Exercise the HTTP surface against a real registry service bound to a
 * scratch file under tmpdir — this covers both the route handlers and
 * their integration with the registry, which is the contract the web
 * dashboard depends on.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createProjectRegistryService } from '../services/project-registry.js';
import { createProjectRoutes } from './projects.js';

function setup() {
  const tmpRoot = mkdtempSync(join(tmpdir(), 'sf-project-routes-'));
  const registryPath = join(tmpRoot, 'projects.json');
  const gitProjectA = join(tmpRoot, 'project-a');
  const gitProjectB = join(tmpRoot, 'project-b');
  mkdirSync(join(gitProjectA, '.git'), { recursive: true });
  mkdirSync(join(gitProjectB, '.git'), { recursive: true });

  const projectRegistry = createProjectRegistryService({ registryPath });
  const app = createProjectRoutes({ projectRegistry });

  return { tmpRoot, gitProjectA, gitProjectB, app, projectRegistry };
}

function cleanup(tmpRoot: string) {
  rmSync(tmpRoot, { recursive: true, force: true });
}

async function request(
  app: ReturnType<typeof createProjectRoutes>,
  method: string,
  path: string,
  body?: unknown
) {
  const init: RequestInit = {
    method,
    headers: body !== undefined ? { 'Content-Type': 'application/json' } : undefined,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  };
  const res = await app.fetch(new Request(`http://test${path}`, init));
  const json = await res.json().catch(() => ({}));
  return { status: res.status, body: json as Record<string, unknown> };
}

describe('project routes', () => {
  let harness: ReturnType<typeof setup>;

  beforeEach(() => {
    harness = setup();
  });

  afterEach(() => {
    cleanup(harness.tmpRoot);
  });

  describe('GET /api/projects', () => {
    it('returns an empty list initially', async () => {
      const res = await request(harness.app, 'GET', '/api/projects');
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ projects: [] });
    });

    it('returns registered projects', async () => {
      await harness.projectRegistry.create({ name: 'Alpha', path: harness.gitProjectA });
      const res = await request(harness.app, 'GET', '/api/projects');
      expect(res.status).toBe(200);
      const projects = res.body.projects as Array<Record<string, string>>;
      expect(projects).toHaveLength(1);
      expect(projects[0]).toMatchObject({
        name: 'Alpha',
        path: resolve(harness.gitProjectA),
      });
    });
  });

  describe('POST /api/projects', () => {
    it('creates a project', async () => {
      const res = await request(harness.app, 'POST', '/api/projects', {
        name: 'Alpha',
        path: harness.gitProjectA,
      });
      expect(res.status).toBe(201);
      const project = res.body.project as Record<string, string>;
      expect(project.name).toBe('Alpha');
      expect(project.path).toBe(resolve(harness.gitProjectA));
      expect(project.id).toMatch(/^proj-/);
    });

    it('rejects missing name', async () => {
      const res = await request(harness.app, 'POST', '/api/projects', {
        path: harness.gitProjectA,
      });
      expect(res.status).toBe(400);
      const error = res.body.error as { code: string };
      expect(error.code).toBe('INVALID_INPUT');
    });

    it('rejects a non-existent path with 400', async () => {
      const res = await request(harness.app, 'POST', '/api/projects', {
        name: 'Ghost',
        path: join(harness.tmpRoot, 'nope'),
      });
      expect(res.status).toBe(400);
      expect((res.body.error as { code: string }).code).toBe('PATH_NOT_FOUND');
    });

    it('rejects a non-git directory with 400', async () => {
      const plain = join(harness.tmpRoot, 'plain');
      mkdirSync(plain, { recursive: true });
      const res = await request(harness.app, 'POST', '/api/projects', {
        name: 'Plain',
        path: plain,
      });
      expect(res.status).toBe(400);
      expect((res.body.error as { code: string }).code).toBe('PATH_NOT_GIT_REPO');
    });

    it('rejects duplicate names with 409', async () => {
      await request(harness.app, 'POST', '/api/projects', {
        name: 'Same',
        path: harness.gitProjectA,
      });
      const res = await request(harness.app, 'POST', '/api/projects', {
        name: 'Same',
        path: harness.gitProjectB,
      });
      expect(res.status).toBe(409);
      expect((res.body.error as { code: string }).code).toBe('NAME_ALREADY_EXISTS');
    });

    it('rejects non-JSON bodies', async () => {
      const res = await harness.app.fetch(
        new Request('http://test/api/projects', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: 'not json',
        })
      );
      expect(res.status).toBe(400);
      const body = (await res.json()) as { error: { code: string } };
      expect(body.error.code).toBe('INVALID_INPUT');
    });
  });

  describe('PATCH /api/projects/:id', () => {
    it('renames a project', async () => {
      const created = await request(harness.app, 'POST', '/api/projects', {
        name: 'Alpha',
        path: harness.gitProjectA,
      });
      const id = (created.body.project as { id: string }).id;

      const res = await request(harness.app, 'PATCH', `/api/projects/${id}`, {
        name: 'Alpha v2',
      });
      expect(res.status).toBe(200);
      expect((res.body.project as { name: string }).name).toBe('Alpha v2');
    });

    it('returns 404 for unknown ids', async () => {
      const res = await request(harness.app, 'PATCH', '/api/projects/proj-missing', {
        name: 'Whatever',
      });
      expect(res.status).toBe(404);
      expect((res.body.error as { code: string }).code).toBe('NOT_FOUND');
    });

    it('requires at least one field', async () => {
      const created = await request(harness.app, 'POST', '/api/projects', {
        name: 'Alpha',
        path: harness.gitProjectA,
      });
      const id = (created.body.project as { id: string }).id;

      const res = await request(harness.app, 'PATCH', `/api/projects/${id}`, {});
      expect(res.status).toBe(400);
      expect((res.body.error as { code: string }).code).toBe('INVALID_INPUT');
    });

    it('surfaces path validation errors', async () => {
      const created = await request(harness.app, 'POST', '/api/projects', {
        name: 'Alpha',
        path: harness.gitProjectA,
      });
      const id = (created.body.project as { id: string }).id;

      const res = await request(harness.app, 'PATCH', `/api/projects/${id}`, {
        path: join(harness.tmpRoot, 'missing'),
      });
      expect(res.status).toBe(400);
      expect((res.body.error as { code: string }).code).toBe('PATH_NOT_FOUND');
    });
  });

  describe('DELETE /api/projects/:id', () => {
    it('removes a project', async () => {
      const created = await request(harness.app, 'POST', '/api/projects', {
        name: 'Alpha',
        path: harness.gitProjectA,
      });
      const id = (created.body.project as { id: string }).id;

      const res = await request(harness.app, 'DELETE', `/api/projects/${id}`);
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ success: true, id });

      const list = await request(harness.app, 'GET', '/api/projects');
      expect(list.body.projects).toEqual([]);
    });

    it('returns 404 for unknown ids', async () => {
      const res = await request(harness.app, 'DELETE', '/api/projects/proj-missing');
      expect(res.status).toBe(404);
      expect((res.body.error as { code: string }).code).toBe('NOT_FOUND');
    });
  });
});
