/**
 * Provider Metrics Routes
 *
 * API endpoint for querying aggregated provider metrics
 * suitable for the web UI and CLI consumption.
 */

import { Hono } from 'hono';
import type { Services } from '../services.js';
import type { MetricsFilter } from '../../services/metrics-service.js';
import { UNASSIGNED_PROJECT_GROUP } from '../../services/metrics-service.js';
import { createLogger } from '../../utils/logger.js';

const logger = createLogger('metrics-routes');

/**
 * Valid values for the `groupBy` query parameter. `project` was added alongside
 * the per-project dimension to support both the per-project filter UI and the
 * cross-project totals view.
 */
type GroupByParam = 'provider' | 'model' | 'agent' | 'project';

const VALID_GROUP_BY: readonly GroupByParam[] = ['provider', 'model', 'agent', 'project'];

/**
 * Parse a time range string (e.g., '7d', '14d', '30d') to number of days.
 * Defaults to 7 if invalid.
 */
function parseTimeRange(value: string | undefined): number {
  if (!value) return 7;
  const match = value.match(/^(\d+)d$/);
  if (match) {
    const days = parseInt(match[1], 10);
    if (days > 0 && days <= 365) return days;
  }
  return 7;
}

/**
 * Translate the raw `projectId` query string into a {@link MetricsFilter}-shaped
 * value. Callers can pass:
 *
 *   - no parameter          → undefined (span all projects, the default)
 *   - `projectId=unassigned`
 *     or `projectId=null`   → null       (metrics with no project assignment)
 *   - `projectId=<id>`      → the id    (scope to that project)
 *
 * Returning the full `{ projectId }` wrapper keeps the distinction between
 * "omitted" and "explicit null" intact when we spread it into the service
 * filter.
 */
function parseProjectFilter(value: string | undefined): MetricsFilter | undefined {
  if (value === undefined) return undefined;
  if (value === UNASSIGNED_PROJECT_GROUP || value === 'null' || value === '') {
    return { projectId: null };
  }
  return { projectId: value };
}

export function createMetricsRoutes(services: Services) {
  const app = new Hono();

  /**
   * GET /api/provider-metrics
   *
   * Query params:
   *   - timeRange: '7d' | '14d' | '30d' (default: '7d')
   *   - groupBy: 'provider' | 'model' | 'agent' | 'project' (default: 'provider')
   *   - projectId: string (optional) — scope aggregation to a single project.
   *                Use the literal value 'unassigned' (or 'null') to restrict
   *                to metrics without a project assignment. Ignored when
   *                groupBy=project (that view already spans all projects).
   *   - includeSeries: 'true' | 'false' (default: 'false') — include time-series data
   *   - sessionId: string (optional) — filter to a specific session; returns metrics for that session only
   */
  app.get('/api/provider-metrics', (c) => {
    try {
      const sessionId = c.req.query('sessionId');
      const timeRangeParam = c.req.query('timeRange');
      const groupBy = c.req.query('groupBy') || 'provider';
      const projectIdParam = c.req.query('projectId');
      const includeSeries = c.req.query('includeSeries') === 'true';

      // If sessionId is provided, return metrics for that session only
      if (sessionId) {
        const sessionMetrics = services.metricsService.getBySession(sessionId);
        const metrics = sessionMetrics ? [sessionMetrics] : [];
        const metricsWithCost = services.costService.enrichWithCosts(metrics, 'session');
        return c.json({
          timeRange: { days: 0, label: 'session' },
          groupBy: 'session',
          metrics: metricsWithCost,
        });
      }

      if (!VALID_GROUP_BY.includes(groupBy as GroupByParam)) {
        return c.json(
          {
            error: {
              code: 'INVALID_PARAM',
              message: 'groupBy must be "provider", "model", "agent", or "project"',
            },
          },
          400
        );
      }

      const days = parseTimeRange(timeRangeParam);
      const timeRange = { days };
      const projectFilter = parseProjectFilter(projectIdParam);

      let aggregated;
      if (groupBy === 'agent') {
        aggregated = services.metricsService.aggregateByAgent(timeRange, projectFilter);
      } else if (groupBy === 'model') {
        aggregated = services.metricsService.aggregateByModel(timeRange, projectFilter);
      } else if (groupBy === 'project') {
        // Cross-project totals view — ignores the projectId filter because it
        // would trivially collapse the result to a single row.
        aggregated = services.metricsService.aggregateByProject(timeRange);
      } else {
        aggregated = services.metricsService.aggregateByProvider(timeRange, projectFilter);
      }

      // Enrich metrics with cost breakdowns. The 'project' group key is a
      // project id (or the 'unassigned' sentinel) rather than a provider/model,
      // so there is no per-model pricing to join on — fall back to the
      // provider enrichment path, which sums per-model costs by querying the
      // underlying rows. When a project filter is active we still get accurate
      // per-project costs because the cost-service helpers re-query the DB.
      // Narrow `groupBy` from string to the cost-service's supported set.
      // The validation above already rejected anything outside VALID_GROUP_BY,
      // but TypeScript can't see through `c.req.query()`'s string type.
      const costGroupBy: 'provider' | 'model' | 'agent' =
        groupBy === 'project' ? 'provider' : (groupBy as 'provider' | 'model' | 'agent');
      const metricsWithCost = services.costService.enrichWithCosts(aggregated, costGroupBy, timeRange);

      const result: {
        timeRange: { days: number; label: string };
        groupBy: string;
        projectId?: string | null;
        metrics: typeof metricsWithCost;
        timeSeries?: ReturnType<typeof services.metricsService.getTimeSeries>;
      } = {
        timeRange: { days, label: `${days}d` },
        groupBy,
        metrics: metricsWithCost,
      };

      // Echo the applied project filter back to callers so clients don't have
      // to re-parse their own query string to know what scope they're viewing.
      if (projectFilter !== undefined) {
        result.projectId = projectFilter.projectId;
      }

      if (includeSeries && (groupBy === 'provider' || groupBy === 'model')) {
        result.timeSeries = services.metricsService.getTimeSeries(timeRange, groupBy, projectFilter);
      }

      return c.json(result);
    } catch (error) {
      logger.error('Failed to get provider metrics:', error);
      return c.json(
        { error: { code: 'INTERNAL_ERROR', message: String(error) } },
        500
      );
    }
  });

  return app;
}
