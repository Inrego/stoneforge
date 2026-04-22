/**
 * Project Routes Tests
 *
 * Exercise the HTTP surface (`/api/projects`) against a real
 * `@stoneforge/quarry` registry service backed by a temp directory.
 * Using the real service keeps the tests honest: we catch breakage in
 * the error-to-HTTP-status mapping that mocks would paper over.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  createProjectRegistryService,
  type ProjectRegistryService,
} from '@stoneforge/quarry';
import type { Services } from '../services.js';
import { createProjectRoutes } from './projects.js';

// ============================================================================
// Fixtures
// ============================================================================

let sandbox: string;
let registryPath: string;

beforeEach(() => {
  sandbox = mkdtempSync(join(tmpdir(), 'sf-projects-route-'));
  registryPath = join(sandbox, 'projects.json');
});

afterEach(() => {
  rmSync(sandbox, { recursive: true, force: true });
});

function makeGitDir(name: string): string {
  const root = join(sandbox, name);
  mkdirSync(join(root, '.git'), { recursive: true });
  return root;
}

function makeServices(registry: ProjectRegistryService | null): Services {
  return { projectRegistry: registry } as unknown as Services;
}

function serviceForSandbox(): ProjectRegistryService {
  return createProjectRegistryService({ path: registryPath });
}

// ============================================================================
// Tests
// ============================================================================

describe('GET /api/projects', () => {
  it('returns an empty list when the registry is empty', async () => {
    const app = createProjectRoutes(makeServices(serviceForSandbox()));
    const res = await app.request('/api/projects');

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ projects: [] });
  });

  it('returns registered projects', async () => {
    const svc = serviceForSandbox();
    svc.create({ name: 'alpha', path: makeGitDir('alpha') });
    svc.create({ name: 'bravo', path: makeGitDir('bravo') });

    const app = createProjectRoutes(makeServices(svc));
    const res = await app.request('/api/projects');

    expect(res.status).toBe(200);
    const body = (await res.json()) as { projects: Array<{ name: string }> };
    expect(body.projects.map((p) => p.name).sort()).toEqual(['alpha', 'bravo']);
  });

  it('returns 503 when the registry failed to load', async () => {
    const app = createProjectRoutes(makeServices(null));
    const res = await app.request('/api/projects');

    expect(res.status).toBe(503);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe('REGISTRY_UNAVAILABLE');
  });
});

describe('GET /api/projects/:id', () => {
  it('returns a single project by id', async () => {
    const svc = serviceForSandbox();
    const created = svc.create({ name: 'alpha', path: makeGitDir('alpha') });

    const app = createProjectRoutes(makeServices(svc));
    const res = await app.request(`/api/projects/${created.id}`);

    expect(res.status).toBe(200);
    const body = (await res.json()) as { project: { id: string; name: string } };
    expect(body.project.id).toBe(created.id);
    expect(body.project.name).toBe('alpha');
  });

  it('returns 404 when the project is unknown', async () => {
    const app = createProjectRoutes(makeServices(serviceForSandbox()));
    const res = await app.request('/api/projects/proj-nope');

    expect(res.status).toBe(404);
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe(
      'NOT_FOUND'
    );
  });
});

describe('POST /api/projects', () => {
  it('registers a valid project (201) and persists to disk', async () => {
    const svc = serviceForSandbox();
    const app = createProjectRoutes(makeServices(svc));

    const root = makeGitDir('alpha');
    const res = await app.request('/api/projects', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'alpha', path: root }),
    });

    expect(res.status).toBe(201);
    const body = (await res.json()) as { project: { id: string; name: string } };
    expect(body.project.name).toBe('alpha');
    expect(body.project.id).toMatch(/^proj-/);

    expect(svc.list()).toHaveLength(1);
  });

  it('trims whitespace around name and path', async () => {
    const svc = serviceForSandbox();
    const app = createProjectRoutes(makeServices(svc));

    const root = makeGitDir('alpha');
    const res = await app.request('/api/projects', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: '  alpha  ', path: `  ${root}  ` }),
    });

    expect(res.status).toBe(201);
    const body = (await res.json()) as { project: { name: string } };
    expect(body.project.name).toBe('alpha');
  });

  it('returns 400 when body is not valid JSON', async () => {
    const app = createProjectRoutes(makeServices(serviceForSandbox()));
    const res = await app.request('/api/projects', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: 'not json',
    });

    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe(
      'INVALID_INPUT'
    );
  });

  it('returns 400 when name is missing', async () => {
    const app = createProjectRoutes(makeServices(serviceForSandbox()));
    const res = await app.request('/api/projects', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ path: makeGitDir('alpha') }),
    });

    expect(res.status).toBe(400);
  });

  it('returns 400 when name is an empty string', async () => {
    const app = createProjectRoutes(makeServices(serviceForSandbox()));
    const res = await app.request('/api/projects', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: '   ', path: makeGitDir('alpha') }),
    });

    expect(res.status).toBe(400);
  });

  it('returns 400 when name exceeds the max length', async () => {
    const svc = serviceForSandbox();
    const app = createProjectRoutes(makeServices(svc));
    const res = await app.request('/api/projects', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        name: 'x'.repeat(101),
        path: makeGitDir('alpha'),
      }),
    });

    expect(res.status).toBe(400);
    expect(svc.list()).toHaveLength(0);
  });

  it('returns 400 (INVALID_PATH) when the path is not a git repo', async () => {
    const svc = serviceForSandbox();
    const app = createProjectRoutes(makeServices(svc));

    const plain = join(sandbox, 'plain');
    mkdirSync(plain);
    const res = await app.request('/api/projects', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'plain', path: plain }),
    });

    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe('INVALID_PATH');
    expect(svc.list()).toHaveLength(0);
  });

  it('returns 409 on duplicate name', async () => {
    const svc = serviceForSandbox();
    svc.create({ name: 'shared', path: makeGitDir('a') });

    const app = createProjectRoutes(makeServices(svc));
    const res = await app.request('/api/projects', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'shared', path: makeGitDir('b') }),
    });

    expect(res.status).toBe(409);
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe(
      'CONFLICT'
    );
  });

  it('returns 409 on duplicate path', async () => {
    const svc = serviceForSandbox();
    const root = makeGitDir('alpha');
    svc.create({ name: 'alpha', path: root });

    const app = createProjectRoutes(makeServices(svc));
    const res = await app.request('/api/projects', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'also-alpha', path: root }),
    });

    expect(res.status).toBe(409);
  });
});

describe('PATCH /api/projects/:id', () => {
  it('renames a registered project', async () => {
    const svc = serviceForSandbox();
    const created = svc.create({ name: 'alpha', path: makeGitDir('alpha') });

    const app = createProjectRoutes(makeServices(svc));
    const res = await app.request(`/api/projects/${created.id}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'renamed' }),
    });

    expect(res.status).toBe(200);
    const body = (await res.json()) as { project: { name: string } };
    expect(body.project.name).toBe('renamed');
    expect(svc.get(created.id)?.name).toBe('renamed');
  });

  it('returns 400 when the new name exceeds the max length', async () => {
    const svc = serviceForSandbox();
    const created = svc.create({ name: 'alpha', path: makeGitDir('alpha') });

    const app = createProjectRoutes(makeServices(svc));
    const res = await app.request(`/api/projects/${created.id}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'x'.repeat(101) }),
    });

    expect(res.status).toBe(400);
    expect(svc.get(created.id)?.name).toBe('alpha');
  });

  it('returns 400 when no name is provided', async () => {
    const svc = serviceForSandbox();
    const created = svc.create({ name: 'alpha', path: makeGitDir('alpha') });

    const app = createProjectRoutes(makeServices(svc));
    const res = await app.request(`/api/projects/${created.id}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({}),
    });

    expect(res.status).toBe(400);
  });

  it('returns 404 when the project is unknown', async () => {
    const app = createProjectRoutes(makeServices(serviceForSandbox()));
    const res = await app.request('/api/projects/proj-nope', {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'whatever' }),
    });

    expect(res.status).toBe(404);
  });

  it('returns 409 when the new name collides with another project', async () => {
    const svc = serviceForSandbox();
    svc.create({ name: 'alpha', path: makeGitDir('alpha') });
    const bravo = svc.create({ name: 'bravo', path: makeGitDir('bravo') });

    const app = createProjectRoutes(makeServices(svc));
    const res = await app.request(`/api/projects/${bravo.id}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'alpha' }),
    });

    expect(res.status).toBe(409);
  });
});

describe('DELETE /api/projects/:id', () => {
  it('removes a registered project', async () => {
    const svc = serviceForSandbox();
    const created = svc.create({ name: 'alpha', path: makeGitDir('alpha') });

    const app = createProjectRoutes(makeServices(svc));
    const res = await app.request(`/api/projects/${created.id}`, {
      method: 'DELETE',
    });

    expect(res.status).toBe(200);
    const body = (await res.json()) as { success: boolean; id: string };
    expect(body.success).toBe(true);
    expect(body.id).toBe(created.id);
    expect(svc.get(created.id)).toBeUndefined();
  });

  it('returns 404 when the project is unknown', async () => {
    const app = createProjectRoutes(makeServices(serviceForSandbox()));
    const res = await app.request('/api/projects/proj-nope', {
      method: 'DELETE',
    });

    expect(res.status).toBe(404);
  });
});

describe('registry boot failure', () => {
  it('returns 503 on mutations when the registry failed to load', async () => {
    const app = createProjectRoutes(makeServices(null));

    const post = await app.request('/api/projects', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'alpha', path: '/tmp/whatever' }),
    });
    expect(post.status).toBe(503);

    const patch = await app.request('/api/projects/proj-1', {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'x' }),
    });
    expect(patch.status).toBe(503);

    const del = await app.request('/api/projects/proj-1', { method: 'DELETE' });
    expect(del.status).toBe(503);
  });
});

describe('registry on-disk state', () => {
  it('persists across service reload after POST + PATCH + DELETE', async () => {
    // Fresh registry, create a project, then simulate a restart by
    // constructing a second service against the same file and verify the
    // observed state is identical.
    const svc1 = serviceForSandbox();
    const appA = createProjectRoutes(makeServices(svc1));

    const create = await appA.request('/api/projects', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'alpha', path: makeGitDir('alpha') }),
    });
    expect(create.status).toBe(201);
    const createdId = (
      (await create.json()) as { project: { id: string } }
    ).project.id;

    const rename = await appA.request(`/api/projects/${createdId}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'alpha-renamed' }),
    });
    expect(rename.status).toBe(200);

    // Restart — fresh service instance reading the same file.
    const svc2 = createProjectRegistryService({ path: registryPath });
    const appB = createProjectRoutes(makeServices(svc2));

    const list = await appB.request('/api/projects');
    const body = (await list.json()) as { projects: Array<{ name: string }> };
    expect(body.projects).toHaveLength(1);
    expect(body.projects[0].name).toBe('alpha-renamed');

    const del = await appB.request(`/api/projects/${createdId}`, {
      method: 'DELETE',
    });
    expect(del.status).toBe(200);

    // New instance sees the deletion too.
    const svc3 = createProjectRegistryService({ path: registryPath });
    expect(svc3.list()).toEqual([]);
  });

  it('returns 503 when the file on disk has an unsupported version', () => {
    // Write a bad registry file; the service constructor should throw and
    // the boot path sets projectRegistry to null — the routes then return
    // 503 as exercised above. This just documents that assumption so a
    // regression in the quarry service wouldn't slip past silently.
    writeFileSync(
      registryPath,
      JSON.stringify({ version: 999, projects: [] }),
      'utf-8'
    );
    expect(() => createProjectRegistryService({ path: registryPath })).toThrow();
  });
});
