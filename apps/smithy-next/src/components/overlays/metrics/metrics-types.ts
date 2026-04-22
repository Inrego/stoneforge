// ── Layout ──
export type LayoutSize = 'wide' | 'medium' | 'narrow'

// ── Time Series ──
export interface TimeSeriesPoint {
  date: string  // ISO date 'YYYY-MM-DD'
  value: number
}

export type TimeRange = '7d' | '14d' | '30d'

// ── Projects ──
/**
 * Lightweight project descriptor used by the per-project filter and the
 * cross-project totals view. The `id` matches the `projectId` stamped onto
 * MetricsTask rows; `null` as a selected project id means "all projects".
 */
export interface MetricsProject {
  id: string
  name: string
}

/**
 * Currently selected project scope. `null` means "all projects" and is the
 * default cross-project totals view.
 */
export type ProjectScope = string | null

// ── Tasks with metrics fields ──
export interface MetricsTask {
  id: string
  title: string
  status: 'backlog' | 'todo' | 'in_progress' | 'in_review' | 'done'
  priority: 'urgent' | 'high' | 'medium' | 'low'
  assignee?: string
  model: string
  provider: string
  /**
   * Owning project id. Aligns with the server-side `project_id` column on
   * provider_metrics so the UI can filter by the same dimension that the API
   * aggregates over.
   */
  projectId: string
  createdAt: number   // ms timestamp
  completedAt?: number
  cycleTimeHours?: number
  // Rework
  handoffHistory: { from: string; to: string; reason: string; timestamp: number }[]
  testRunCount: number
  reconciliationCount: number
  stuckMergeRecoveryCount: number
  stewardRecoveryCount: number
  resumeCount: number
  // Merge
  mergeStatus: 'pending' | 'testing' | 'merging' | 'merged' | 'conflict' | 'test_failed' | 'failed'
  // Sessions
  sessionHistory: { agentId: string; agentName: string; model: string; provider: string; startedAt: number; endedAt?: number }[]
  // Issues & Events
  reportedIssues: string[]
  events: { type: 'created' | 'updated' | 'closed' | 'reopened' | 'auto_blocked'; timestamp: number }[]
  // CI
  ciPassOnFirstAttempt: boolean
  // Links
  linkedMRId?: string
  linkedCIRunId?: string
}

// ── Model-level aggregates ──
export interface ModelMetrics {
  model: string
  provider: string
  // Volume
  tasksCompleted: number
  mrsMerged: number
  sessionsCount: number
  // Speed
  avgTaskDurationHours: number
  avgTimeToMergeHours: number
  // Cost
  totalCost: number
  costPerCompletedTask: number
  costPerMergedMR: number
  // Quality
  ciPassRateFirstAttempt: number  // 0-1
  reopenRate: number              // 0-1
  handoffRate: number             // 0-1
  testFailureRate: number         // 0-1
  // Tokens
  totalTokensIn: number
  totalTokensOut: number
  cacheHitRate: number            // 0-1
  // Rework
  avgTestRunCount: number
  avgReconciliationCount: number
  avgResumeCount: number
}

// ── Agent performance ──
export interface AgentPerformance {
  agentId: string
  agentName: string
  role: string
  model: string
  provider: string
  tasksCompleted: number
  avgCycleTimeHours: number
  totalCost: number
  errorRate: number
}

// ── Bottlenecks ──
export interface Bottleneck {
  id: string
  type: 'blocked_task' | 'failing_ci' | 'stale_mr' | 'stuck_merge' | 'high_rework'
  title: string
  detail: string
  severity: 'high' | 'medium' | 'low'
  linkedTaskId?: string
  linkedMRId?: string
  linkedCIRunId?: string
  age: string
}

// ── Computed insights ──
export interface Insight {
  id: string
  type: 'speed' | 'cost' | 'quality' | 'efficiency'
  message: string
  severity: 'info' | 'warning' | 'success'
  relatedModels: string[]
}

// ── Usage tab types ──
export interface UsageStats {
  totalTokens: number
  totalTokensIn: number
  totalTokensOut: number
  totalCacheTokens: number
  estimatedCost: number
  totalSessions: number
  totalToolCalls: number
}

export interface ActivityDay {
  date: string     // ISO date
  tasks: number
  mrs: number
  sessions: number
}

export interface AgentTokenSplit {
  role: string
  label: string
  tokens: number
  color: string
}

export interface ModelTokenUsage {
  model: string
  tokens: number
  color: string
}

export interface CodeChurn {
  linesAdded: number
  linesRemoved: number
  totalChanged: number
}

export interface UsageInsightCard {
  label: string
  value: string
  subtitle: string
}

// ── Per-project aggregates (cross-project totals view) ──
/**
 * Rolled-up metrics for a single project across the selected time range.
 * Used by the cross-project totals view on the Overview tab so operators can
 * compare spend and throughput between projects at a glance.
 */
export interface ProjectMetrics {
  projectId: string
  projectName: string
  tasksCompleted: number
  mrsMerged: number
  sessionsCount: number
  totalCost: number
  totalTokens: number
  avgCycleTimeHours: number
}
