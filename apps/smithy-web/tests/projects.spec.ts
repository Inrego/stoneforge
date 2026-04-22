import { test, expect } from '@playwright/test';

test.describe('Projects Page', () => {
  test.describe('Page layout', () => {
    test('navigates to /projects from the sidebar', async ({ page }) => {
      await page.goto('/');
      await page.getByTestId('nav-projects').click();

      await expect(page).toHaveURL(/\/projects/);
      await expect(page.getByTestId('projects-page')).toBeVisible();
    });

    test('renders the page header and actions', async ({ page }) => {
      await page.goto('/projects');

      await expect(page.getByTestId('projects-page-title')).toHaveText('Projects');
      await expect(page.getByTestId('projects-create')).toBeVisible();
      await expect(page.getByTestId('projects-refresh')).toBeVisible();
    });

    test('shows the empty state when no projects are registered', async ({ page }) => {
      // The test server uses a fresh ~/.stoneforge-test/projects.json which may
      // already have entries from parallel tests — only assert the empty state
      // when the list is genuinely empty to avoid cross-test flake.
      await page.route('**/api/projects', async (route) => {
        if (route.request().method() === 'GET') {
          await route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify({ projects: [] }),
          });
        } else {
          await route.fallback();
        }
      });

      await page.goto('/projects');

      await expect(page.getByTestId('projects-empty')).toBeVisible();
      await expect(page.getByTestId('projects-empty-create')).toBeVisible();
    });

    test('renders a list when projects are present', async ({ page }) => {
      await page.route('**/api/projects', async (route) => {
        if (route.request().method() === 'GET') {
          await route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify({
              projects: [
                {
                  id: 'proj-aaaa1111',
                  name: 'alpha-workspace',
                  path: '/tmp/alpha',
                  registeredAt: '2026-04-22T12:00:00.000Z',
                },
                {
                  id: 'proj-bbbb2222',
                  name: 'beta-workspace',
                  path: '/tmp/beta',
                  registeredAt: '2026-04-22T12:00:00.000Z',
                },
              ],
            }),
          });
        } else {
          await route.fallback();
        }
      });

      await page.goto('/projects');

      const rows = page.getByTestId('project-row');
      await expect(rows).toHaveCount(2);
      await expect(rows.first()).toContainText('alpha-workspace');
      await expect(rows.nth(1)).toContainText('beta-workspace');
    });
  });

  test.describe('Register dialog', () => {
    test('opens and closes the register dialog', async ({ page }) => {
      await page.route('**/api/projects', async (route) => {
        if (route.request().method() === 'GET') {
          await route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify({ projects: [] }),
          });
        } else {
          await route.fallback();
        }
      });

      await page.goto('/projects');
      await page.getByTestId('projects-create').click();

      await expect(page.getByTestId('project-dialog')).toBeVisible();
      await expect(page.getByTestId('project-dialog')).toContainText('Register Project');

      await page.getByTestId('project-dialog-cancel').click();
      await expect(page.getByTestId('project-dialog')).toBeHidden();
    });

    test('surfaces server-side validation errors', async ({ page }) => {
      await page.route('**/api/projects', async (route) => {
        const method = route.request().method();
        if (method === 'GET') {
          await route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify({ projects: [] }),
          });
        } else if (method === 'POST') {
          await route.fulfill({
            status: 400,
            contentType: 'application/json',
            body: JSON.stringify({
              error: {
                code: 'PATH_NOT_GIT_REPO',
                message: 'Path is not a git repository (no .git entry at /tmp/not-a-repo)',
              },
            }),
          });
        } else {
          await route.fallback();
        }
      });

      await page.goto('/projects');
      await page.getByTestId('projects-create').click();

      await page.getByTestId('project-name-input').fill('demo');
      await page.getByTestId('project-path-input').fill('/tmp/not-a-repo');
      await page.getByTestId('project-dialog-submit').click();

      await expect(page.getByTestId('project-dialog-error')).toContainText(
        'not a git repository'
      );
    });
  });
});
