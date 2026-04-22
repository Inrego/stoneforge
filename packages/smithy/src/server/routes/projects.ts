/**
 * Project Routes
 *
 * HTTP endpoints backing the dashboard Projects page. Wraps the quarry
 * project registry service (`~/.stoneforge/projects.json`) with CRUD
 * operations:
 *
 *   GET    /api/projects         List registered projects
 *   POST   /api/projects         Register a project ({ name, path })
 *   PATCH  /api/projects/:id     Rename a registered project
 *   DELETE /api/projects/:id     Remove a project from the registry
 *
 * Registry-level validation (empty name, duplicate name/path, git-repo
 * check) lives in `@stoneforge/quarry`'s projects module; this file is
 * only the HTTP surface.
 */

import { Hono } from 'hono';
import type { Context } from 'hono';
import { ProjectPathError, ProjectRegistryError } from '@stoneforge/quarry';
import type { Services } from '../services.js';
import { createLogger } from '../../utils/logger.js';

const logger = createLogger('projects-routes');

// Defensive upper bounds applied at the HTTP boundary so a malicious
// client can't DOS the registry by writing arbitrarily large strings to
// `~/.stoneforge/projects.json`. The quarry registry itself does not
// cap these; match `@stoneforge/core`'s Project element constants.
const MAX_PROJECT_NAME_LENGTH = 100;
const MAX_PROJECT_PATH_LENGTH = 4096;

// Error codes surfaced to the frontend. Keeping them stable lets the UI
// render code-specific messages without string-matching the human text.
const ERR_REGISTRY_UNAVAILABLE = 'REGISTRY_UNAVAILABLE';
const ERR_INVALID_INPUT = 'INVALID_INPUT';
const ERR_NOT_FOUND = 'NOT_FOUND';
const ERR_CONFLICT = 'CONFLICT';
const ERR_INVALID_PATH = 'INVALID_PATH';
const ERR_INTERNAL = 'INTERNAL_ERROR';

export function createProjectRoutes(services: Services) {
  const { projectRegistry } = services;
  const app = new Hono();

  // Short-circuit every route with a 503 when the registry couldn't be
  // loaded (malformed JSON, unsupported version, ...). The server keeps
  // running so the rest of the dashboard still works.
  const requireRegistry = (c: Context) => {
    if (!projectRegistry) {
      return c.json(
        {
          error: {
            code: ERR_REGISTRY_UNAVAILABLE,
            message:
              'Projects registry could not be loaded. Check the server logs for details.',
          },
        },
        503
      );
    }
    return null;
  };

  // GET /api/projects — list all registered projects.
  app.get('/api/projects', (c) => {
    const gate = requireRegistry(c);
    if (gate) return gate;
    try {
      return c.json({ projects: projectRegistry!.list() });
    } catch (err) {
      return handleError(c, err, 'Failed to list projects');
    }
  });

  // GET /api/projects/:id — fetch a single project.
  app.get('/api/projects/:id', (c) => {
    const gate = requireRegistry(c);
    if (gate) return gate;
    const id = c.req.param('id');
    const project = projectRegistry!.get(id);
    if (!project) {
      return c.json(
        { error: { code: ERR_NOT_FOUND, message: `Project "${id}" not found` } },
        404
      );
    }
    return c.json({ project });
  });

  // POST /api/projects — register a new project.
  app.post('/api/projects', async (c) => {
    const gate = requireRegistry(c);
    if (gate) return gate;

    const parsed = await readJsonBody(c);
    if (!parsed.ok) return parsed.response;

    const body = parsed.body;
    const nameResult = expectBoundedString(
      body.name,
      'name',
      MAX_PROJECT_NAME_LENGTH
    );
    if (!nameResult.ok) return badInput(c, nameResult.message);
    const pathResult = expectBoundedString(
      body.path,
      'path',
      MAX_PROJECT_PATH_LENGTH
    );
    if (!pathResult.ok) return badInput(c, pathResult.message);

    try {
      const project = projectRegistry!.create({
        name: nameResult.value,
        path: pathResult.value,
      });
      logger.info(
        `Registered project "${project.name}" (${project.id}) at ${project.path}`
      );
      return c.json({ project }, 201);
    } catch (err) {
      return handleError(c, err, 'Failed to create project');
    }
  });

  // PATCH /api/projects/:id — rename a registered project.
  // Only `name` is mutable; relocating a project is intentionally not
  // supported because it would break every worker/session already using
  // the old path. To relocate, delete and re-register.
  app.patch('/api/projects/:id', async (c) => {
    const gate = requireRegistry(c);
    if (gate) return gate;

    const id = c.req.param('id');
    const parsed = await readJsonBody(c);
    if (!parsed.ok) return parsed.response;

    const body = parsed.body;
    if (body.name === undefined) {
      return badInput(c, 'At least one of `name` must be provided');
    }
    const nameResult = expectBoundedString(
      body.name,
      'name',
      MAX_PROJECT_NAME_LENGTH
    );
    if (!nameResult.ok) return badInput(c, nameResult.message);

    try {
      const project = projectRegistry!.update(id, { name: nameResult.value });
      logger.info(`Renamed project ${id} → "${project.name}"`);
      return c.json({ project });
    } catch (err) {
      return handleError(c, err, `Failed to update project ${id}`);
    }
  });

  // DELETE /api/projects/:id — remove a project from the registry.
  app.delete('/api/projects/:id', (c) => {
    const gate = requireRegistry(c);
    if (gate) return gate;

    const id = c.req.param('id');
    try {
      const removed = projectRegistry!.remove(id);
      if (!removed) {
        return c.json(
          { error: { code: ERR_NOT_FOUND, message: `Project "${id}" not found` } },
          404
        );
      }
      logger.info(`Removed project ${id}`);
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

type JsonBodyResult =
  | { ok: true; body: Record<string, unknown> }
  | { ok: false; response: Response };

/**
 * Reads and validates the request body as a JSON object. Returns either
 * the parsed object or a pre-built 400 response — callers just forward
 * the response back to Hono.
 */
async function readJsonBody(c: Context): Promise<JsonBodyResult> {
  let raw: unknown;
  try {
    raw = await c.req.json();
  } catch {
    return {
      ok: false,
      response: c.json(
        { error: { code: ERR_INVALID_INPUT, message: 'Request body must be JSON' } },
        400
      ),
    };
  }
  if (!isPlainObject(raw)) {
    return {
      ok: false,
      response: c.json(
        {
          error: {
            code: ERR_INVALID_INPUT,
            message: 'Request body must be a JSON object',
          },
        },
        400
      ),
    };
  }
  return { ok: true, body: raw };
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

type StringResult =
  | { ok: true; value: string }
  | { ok: false; message: string };

/**
 * Validates a string field is present, non-empty after trimming, and
 * within `maxLength` characters. Returns the trimmed value on success.
 * The length guard is enforced here rather than in the quarry registry
 * because the registry is deliberately permissive — we only need to
 * cap values that travel across the HTTP boundary.
 */
function expectBoundedString(
  raw: unknown,
  field: string,
  maxLength: number
): StringResult {
  if (typeof raw !== 'string') {
    return { ok: false, message: `\`${field}\` must be a string` };
  }
  const trimmed = raw.trim();
  if (trimmed.length === 0) {
    return { ok: false, message: `\`${field}\` must not be empty` };
  }
  if (trimmed.length > maxLength) {
    return {
      ok: false,
      message: `\`${field}\` must be ${maxLength} characters or fewer`,
    };
  }
  return { ok: true, value: trimmed };
}

function badInput(c: Context, message: string) {
  return c.json({ error: { code: ERR_INVALID_INPUT, message } }, 400);
}

/**
 * Maps the quarry registry's typed errors onto HTTP status codes:
 *   - `ProjectPathError`                    → 400 (bad filesystem path)
 *   - `ProjectRegistryError: "No project …"`→ 404 (unknown id)
 *   - `ProjectRegistryError: "… already …"` → 409 (name/path collision)
 *   - anything else                         → 500
 */
function handleError(c: Context, err: unknown, fallbackMessage: string) {
  if (err instanceof ProjectPathError) {
    logger.warn(`${fallbackMessage}: ${err.message}`);
    return c.json({ error: { code: ERR_INVALID_PATH, message: err.message } }, 400);
  }
  if (err instanceof ProjectRegistryError) {
    const { status, code } = classifyRegistryError(err.message);
    const logLevel = status >= 500 ? 'error' : 'warn';
    logger[logLevel](`${fallbackMessage}: ${err.message}`);
    return c.json({ error: { code, message: err.message } }, status);
  }
  logger.error(fallbackMessage, err);
  return c.json(
    {
      error: {
        code: ERR_INTERNAL,
        message: err instanceof Error ? err.message : String(err),
      },
    },
    500
  );
}

/**
 * The quarry registry throws one generic `ProjectRegistryError` for both
 * unknown-id and uniqueness failures. Classify by message so the API
 * returns the right 404 vs. 409 status without changing the shared
 * registry module.
 */
function classifyRegistryError(
  message: string
): { status: 400 | 404 | 409 | 500; code: string } {
  if (/^No project with id/i.test(message)) {
    return { status: 404, code: ERR_NOT_FOUND };
  }
  if (/already registered/i.test(message)) {
    return { status: 409, code: ERR_CONFLICT };
  }
  if (/cannot be empty/i.test(message)) {
    return { status: 400, code: ERR_INVALID_INPUT };
  }
  return { status: 500, code: ERR_INTERNAL };
}
