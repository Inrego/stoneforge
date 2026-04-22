/**
 * Project Routes
 *
 * HTTP endpoints backing the dashboard Projects page. Wraps the project
 * registry service (~/.stoneforge/projects.json) with CRUD operations.
 *
 *   GET    /api/projects        List registered projects
 *   POST   /api/projects        Register a project ({ name, path })
 *   PATCH  /api/projects/:id    Rename / relocate an existing project
 *   DELETE /api/projects/:id    Remove a project from the registry
 *
 * Registry-level validation lives in project-registry.ts; this module is
 * purely the HTTP surface.
 */

import { Hono } from 'hono';
import type { Context } from 'hono';
import {
  ProjectRegistryError,
  type ProjectErrorCode,
  type ProjectRegistryService,
} from '../services/project-registry.js';
import { createLogger } from '../../utils/logger.js';

const logger = createLogger('orchestrator');

export interface ProjectRoutesDeps {
  projectRegistry: ProjectRegistryService;
}

export function createProjectRoutes(deps: ProjectRoutesDeps) {
  const { projectRegistry } = deps;
  const app = new Hono();

  // GET /api/projects — list all registered projects
  app.get('/api/projects', (c) => {
    try {
      return c.json({ projects: projectRegistry.list() });
    } catch (err) {
      return handleError(c, err, 'Failed to list projects');
    }
  });

  // GET /api/projects/:id — fetch a single project
  app.get('/api/projects/:id', (c) => {
    try {
      const entry = projectRegistry.get(c.req.param('id'));
      if (!entry) {
        return c.json(
          { error: { code: 'NOT_FOUND', message: 'Project not found' } },
          404
        );
      }
      return c.json({ project: entry });
    } catch (err) {
      return handleError(c, err, 'Failed to fetch project');
    }
  });

  // POST /api/projects — register a new project
  app.post('/api/projects', async (c) => {
    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      return c.json(
        { error: { code: 'INVALID_INPUT', message: 'Request body must be JSON' } },
        400
      );
    }
    if (!isObject(body)) {
      return c.json(
        { error: { code: 'INVALID_INPUT', message: 'Request body must be a JSON object' } },
        400
      );
    }

    const name = typeof body.name === 'string' ? body.name : '';
    const path = typeof body.path === 'string' ? body.path : '';

    try {
      const entry = await projectRegistry.create({ name, path });
      return c.json({ project: entry }, 201);
    } catch (err) {
      return handleError(c, err, 'Failed to create project');
    }
  });

  // PATCH /api/projects/:id — rename / relocate
  app.patch('/api/projects/:id', async (c) => {
    const id = c.req.param('id');

    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      return c.json(
        { error: { code: 'INVALID_INPUT', message: 'Request body must be JSON' } },
        400
      );
    }
    if (!isObject(body)) {
      return c.json(
        { error: { code: 'INVALID_INPUT', message: 'Request body must be a JSON object' } },
        400
      );
    }

    const input: { name?: string; path?: string } = {};
    if (body.name !== undefined) {
      if (typeof body.name !== 'string') {
        return c.json(
          { error: { code: 'INVALID_INPUT', message: 'name must be a string' } },
          400
        );
      }
      input.name = body.name;
    }
    if (body.path !== undefined) {
      if (typeof body.path !== 'string') {
        return c.json(
          { error: { code: 'INVALID_INPUT', message: 'path must be a string' } },
          400
        );
      }
      input.path = body.path;
    }

    if (input.name === undefined && input.path === undefined) {
      return c.json(
        {
          error: {
            code: 'INVALID_INPUT',
            message: 'At least one of name or path must be provided',
          },
        },
        400
      );
    }

    try {
      const entry = await projectRegistry.update(id, input);
      return c.json({ project: entry });
    } catch (err) {
      return handleError(c, err, `Failed to update project ${id}`);
    }
  });

  // DELETE /api/projects/:id — remove from the registry
  app.delete('/api/projects/:id', async (c) => {
    const id = c.req.param('id');
    try {
      const removed = await projectRegistry.remove(id);
      if (!removed) {
        return c.json(
          { error: { code: 'NOT_FOUND', message: 'Project not found' } },
          404
        );
      }
      return c.json({ success: true, id });
    } catch (err) {
      return handleError(c, err, `Failed to delete project ${id}`);
    }
  });

  return app;
}

// ============================================================================
// Helpers
// ============================================================================

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function handleError(
  c: Context,
  err: unknown,
  fallbackMessage: string
) {
  if (err instanceof ProjectRegistryError) {
    const status = statusFor(err.code);
    // 4xx responses are user-input problems; log at warn, not error.
    if (status < 500) {
      logger.warn(`${fallbackMessage}: ${err.code} ${err.message}`);
    } else {
      logger.error(`${fallbackMessage}: ${err.code} ${err.message}`);
    }
    return c.json({ error: { code: err.code, message: err.message } }, status);
  }
  logger.error(fallbackMessage, err);
  return c.json(
    {
      error: {
        code: 'INTERNAL_ERROR',
        message: err instanceof Error ? err.message : String(err),
      },
    },
    500
  );
}

function statusFor(code: ProjectErrorCode): 400 | 404 | 409 | 500 {
  switch (code) {
    case 'INVALID_INPUT':
    case 'PATH_NOT_FOUND':
    case 'PATH_NOT_DIRECTORY':
    case 'PATH_NOT_GIT_REPO':
      return 400;
    case 'NOT_FOUND':
      return 404;
    case 'NAME_ALREADY_EXISTS':
    case 'PATH_ALREADY_REGISTERED':
      return 409;
    case 'REGISTRY_CORRUPT':
    case 'REGISTRY_IO_ERROR':
      return 500;
  }
}
