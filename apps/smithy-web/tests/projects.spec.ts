/**
 * Projects Page — E2E smoke tests.
 *
 * These exercise only the dashboard surface: layout, search, and
 * dialog open/close flows. The backing API is intercepted via
 * `page.route` so the tests never touch the user's real
 * `~/.stoneforge/projects.json` registry and don't depend on server
 * state between runs.
 */

import { expect, test, type Route } from '@playwright/test';

interface StubProject {
  id: string;
  name: string;
  path: string;
  registeredAt: string;
}

function fulfillJson(route: Route, status: number, body: unknown) {
  return route.fulfill({
    status,
    contentType: 'application/json',
    body: JSON.stringify(body),
  });
}

function routeProjects(projects: StubProject[]) {
  return async (route: Route) => {
    const method = route.request().method();
    if (method === 'GET') {
      return fulfillJson(route, 200, { projects });
    }
    return fulfillJson(route, 405, { error: { code: 'NOT_ALLOWED', message: 'Stub' } });
  };
}

test.describe('Projects page', () => {
  test('renders the page header and register button', async ({ page }) => {
    await page.route('**/api/projects', routeProjects([]));

    await page.goto('/projects');

    await expect(page.getByTestId('projects-page')).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Projects' })).toBeVisible();
    await expect(
      page.getByText('Workspaces registered with Stoneforge on this machine.')
    ).toBeVisible();
    await expect(page.getByTestId('projects-page-register-btn')).toBeVisible();
  });

  test('shows the empty state when there are no projects', async ({ page }) => {
    await page.route('**/api/projects', routeProjects([]));

    await page.goto('/projects');

    await expect(page.getByTestId('projects-page-empty')).toBeVisible();
    await expect(page.getByText('No registered projects yet')).toBeVisible();
    await expect(page.getByTestId('projects-page-empty-register-btn')).toBeVisible();
  });

  test('lists registered projects and filters by the search field', async ({ page }) => {
    const projects: StubProject[] = [
      {
        id: 'proj-abc001',
        name: 'alpha',
        path: '/tmp/alpha',
        registeredAt: new Date().toISOString(),
      },
      {
        id: 'proj-abc002',
        name: 'bravo',
        path: '/tmp/bravo',
        registeredAt: new Date().toISOString(),
      },
    ];

    await page.route('**/api/projects', routeProjects(projects));

    await page.goto('/projects');

    await expect(page.getByTestId('project-row-proj-abc001')).toBeVisible();
    await expect(page.getByTestId('project-row-proj-abc002')).toBeVisible();

    await page.getByTestId('projects-page-search').fill('alpha');

    await expect(page.getByTestId('project-row-proj-abc001')).toBeVisible();
    await expect(page.getByTestId('project-row-proj-abc002')).not.toBeVisible();
  });

  test('opens and closes the register dialog', async ({ page }) => {
    await page.route('**/api/projects', routeProjects([]));

    await page.goto('/projects');

    await page.getByTestId('projects-page-register-btn').click();

    const dialog = page.getByTestId('project-form-dialog');
    await expect(dialog).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Register Project' })).toBeVisible();

    await expect(page.getByTestId('project-name-input')).toBeVisible();
    await expect(page.getByTestId('project-path-input')).toBeVisible();
    await expect(page.getByTestId('project-form-submit')).toBeDisabled();

    await page.getByTestId('project-form-cancel').click();
    await expect(dialog).not.toBeVisible();
  });

  test('submit button enables once name and path are both filled', async ({ page }) => {
    await page.route('**/api/projects', routeProjects([]));

    await page.goto('/projects');

    await page.getByTestId('projects-page-register-btn').click();

    await page.getByTestId('project-name-input').fill('my-project');
    await expect(page.getByTestId('project-form-submit')).toBeDisabled();

    await page.getByTestId('project-path-input').fill('/tmp/my-project');
    await expect(page.getByTestId('project-form-submit')).toBeEnabled();
  });

  test('opens the rename dialog with the project pre-filled and path read-only', async ({ page }) => {
    const project: StubProject = {
      id: 'proj-abc001',
      name: 'alpha',
      path: '/tmp/alpha',
      registeredAt: new Date().toISOString(),
    };

    await page.route('**/api/projects', routeProjects([project]));

    await page.goto('/projects');

    await page.getByTestId(`project-row-edit-${project.id}`).click();

    await expect(page.getByTestId('project-form-dialog')).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Rename Project' })).toBeVisible();
    await expect(page.getByTestId('project-name-input')).toHaveValue('alpha');
    await expect(page.getByTestId('project-path-input')).toHaveValue('/tmp/alpha');
    await expect(page.getByTestId('project-path-input')).toHaveAttribute(
      'readonly',
      ''
    );
  });

  test('opens the delete confirmation dialog with the project info', async ({ page }) => {
    const project: StubProject = {
      id: 'proj-abc001',
      name: 'alpha',
      path: '/tmp/alpha',
      registeredAt: new Date().toISOString(),
    };

    await page.route('**/api/projects', routeProjects([project]));

    await page.goto('/projects');

    await page.getByTestId(`project-row-delete-${project.id}`).click();

    const dialog = page.getByTestId('delete-project-dialog');
    await expect(dialog).toBeVisible();
    await expect(dialog.getByText('"alpha"')).toBeVisible();
    await expect(dialog.getByText('/tmp/alpha')).toBeVisible();
    await expect(page.getByTestId('delete-project-confirm-btn')).toBeVisible();

    await page.getByTestId('delete-project-cancel-btn').click();
    await expect(dialog).not.toBeVisible();
  });

  test('surfaces an error state when the registry is unavailable', async ({ page }) => {
    await page.route('**/api/projects', (route) =>
      fulfillJson(route, 503, {
        error: {
          code: 'REGISTRY_UNAVAILABLE',
          message: 'Projects registry could not be loaded.',
        },
      })
    );

    await page.goto('/projects');

    await expect(page.getByTestId('projects-page-error')).toBeVisible();
    await expect(page.getByText("Couldn't load projects")).toBeVisible();
  });
});

test.describe('Sidebar navigation', () => {
  test('navigates from the sidebar to the Projects page', async ({ page }) => {
    await page.route('**/api/projects', routeProjects([]));

    await page.goto('/activity');
    await page.getByTestId('nav-projects').click();

    await expect(page).toHaveURL(/\/projects/);
    await expect(page.getByTestId('projects-page')).toBeVisible();
  });
});
