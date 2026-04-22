/**
 * Agent Types Tests
 */

import { describe, test, expect } from 'bun:test';
import type {
  CronTrigger,
  EventTrigger,
  DirectorMetadata,
  WorkerMetadata,
  StewardMetadata,
} from './agent.js';
import {
  AgentRoleValues,
  WorkerModeValues,
  StewardFocusValues,
  isAgentRole,
  isWorkerMode,
  isStewardFocus,
  isCronTrigger,
  isEventTrigger,
  isStewardTrigger,
  isDirectorMetadata,
  isWorkerMetadata,
  isStewardMetadata,
  validateAgentMetadata,
  agentMatchesProject,
} from './agent.js';
import type { ProjectId } from '@stoneforge/core';

describe('AgentRole', () => {
  test('AgentRoleValues contains all valid roles', () => {
    expect(AgentRoleValues).toEqual(['director', 'steward', 'worker']);
  });

  test('isAgentRole returns true for valid roles', () => {
    expect(isAgentRole('director')).toBe(true);
    expect(isAgentRole('steward')).toBe(true);
    expect(isAgentRole('worker')).toBe(true);
  });

  test('isAgentRole returns false for invalid roles', () => {
    expect(isAgentRole('admin')).toBe(false);
    expect(isAgentRole('human')).toBe(false);
    expect(isAgentRole('')).toBe(false);
    expect(isAgentRole(null)).toBe(false);
    expect(isAgentRole(undefined)).toBe(false);
    expect(isAgentRole(123)).toBe(false);
  });
});

describe('WorkerMode', () => {
  test('WorkerModeValues contains all valid modes', () => {
    expect(WorkerModeValues).toEqual(['ephemeral', 'persistent']);
  });

  test('isWorkerMode returns true for valid modes', () => {
    expect(isWorkerMode('ephemeral')).toBe(true);
    expect(isWorkerMode('persistent')).toBe(true);
  });

  test('isWorkerMode returns false for invalid modes', () => {
    expect(isWorkerMode('temporary')).toBe(false);
    expect(isWorkerMode('permanent')).toBe(false);
    expect(isWorkerMode('')).toBe(false);
    expect(isWorkerMode(null)).toBe(false);
  });
});

describe('StewardFocus', () => {
  test('StewardFocusValues contains all valid focus areas', () => {
    expect(StewardFocusValues).toEqual(['merge', 'docs', 'recovery', 'custom']);
  });

  test('isStewardFocus returns true for valid focus areas', () => {
    expect(isStewardFocus('merge')).toBe(true);
    expect(isStewardFocus('docs')).toBe(true);
    expect(isStewardFocus('recovery')).toBe(true);
    expect(isStewardFocus('custom')).toBe(true);
  });

  test('isStewardFocus returns false for invalid focus areas', () => {
    expect(isStewardFocus('health')).toBe(false);
    expect(isStewardFocus('reminder')).toBe(false);
    expect(isStewardFocus('ops')).toBe(false);
    expect(isStewardFocus('cleanup')).toBe(false);
    expect(isStewardFocus('')).toBe(false);
    expect(isStewardFocus(null)).toBe(false);
  });
});

describe('StewardTrigger', () => {
  test('isCronTrigger identifies cron triggers', () => {
    const cronTrigger: CronTrigger = { type: 'cron', schedule: '0 2 * * *' };
    const eventTrigger: EventTrigger = { type: 'event', event: 'task_completed' };

    expect(isCronTrigger(cronTrigger)).toBe(true);
    expect(isCronTrigger(eventTrigger)).toBe(false);
  });

  test('isEventTrigger identifies event triggers', () => {
    const cronTrigger: CronTrigger = { type: 'cron', schedule: '0 2 * * *' };
    const eventTrigger: EventTrigger = { type: 'event', event: 'task_completed' };

    expect(isEventTrigger(eventTrigger)).toBe(true);
    expect(isEventTrigger(cronTrigger)).toBe(false);
  });

  test('isStewardTrigger validates cron triggers', () => {
    expect(isStewardTrigger({ type: 'cron', schedule: '0 2 * * *' })).toBe(true);
    expect(isStewardTrigger({ type: 'cron' })).toBe(false);
    expect(isStewardTrigger({ type: 'cron', schedule: 123 })).toBe(false);
  });

  test('isStewardTrigger validates event triggers', () => {
    expect(isStewardTrigger({ type: 'event', event: 'task_completed' })).toBe(true);
    expect(isStewardTrigger({ type: 'event', event: 'branch_ready', condition: "task.status === 'closed'" })).toBe(true);
    expect(isStewardTrigger({ type: 'event' })).toBe(false);
    expect(isStewardTrigger({ type: 'event', event: 123 })).toBe(false);
  });

  test('isStewardTrigger rejects invalid triggers', () => {
    expect(isStewardTrigger(null)).toBe(false);
    expect(isStewardTrigger(undefined)).toBe(false);
    expect(isStewardTrigger({})).toBe(false);
    expect(isStewardTrigger({ type: 'unknown' })).toBe(false);
  });
});

describe('AgentMetadata type guards', () => {
  test('isDirectorMetadata identifies director metadata', () => {
    const director: DirectorMetadata = { agentRole: 'director', sessionStatus: 'idle', projectId: 'proj-test' };
    const worker: WorkerMetadata = { agentRole: 'worker', workerMode: 'ephemeral', sessionStatus: 'idle' };
    const steward: StewardMetadata = { agentRole: 'steward', stewardFocus: 'merge', sessionStatus: 'idle' };

    expect(isDirectorMetadata(director)).toBe(true);
    expect(isDirectorMetadata(worker)).toBe(false);
    expect(isDirectorMetadata(steward)).toBe(false);
  });

  test('isWorkerMetadata identifies worker metadata', () => {
    const director: DirectorMetadata = { agentRole: 'director', sessionStatus: 'idle', projectId: 'proj-test' };
    const worker: WorkerMetadata = { agentRole: 'worker', workerMode: 'ephemeral', sessionStatus: 'idle' };
    const steward: StewardMetadata = { agentRole: 'steward', stewardFocus: 'merge', sessionStatus: 'idle' };

    expect(isWorkerMetadata(worker)).toBe(true);
    expect(isWorkerMetadata(director)).toBe(false);
    expect(isWorkerMetadata(steward)).toBe(false);
  });

  test('isStewardMetadata identifies steward metadata', () => {
    const director: DirectorMetadata = { agentRole: 'director', sessionStatus: 'idle', projectId: 'proj-test' };
    const worker: WorkerMetadata = { agentRole: 'worker', workerMode: 'ephemeral', sessionStatus: 'idle' };
    const steward: StewardMetadata = { agentRole: 'steward', stewardFocus: 'merge', sessionStatus: 'idle' };

    expect(isStewardMetadata(steward)).toBe(true);
    expect(isStewardMetadata(director)).toBe(false);
    expect(isStewardMetadata(worker)).toBe(false);
  });
});

describe('validateAgentMetadata', () => {
  test('validates director metadata', () => {
    // Directors require a non-empty projectId (per-project registration).
    expect(validateAgentMetadata({ agentRole: 'director', projectId: 'proj-a' })).toBe(true);
    expect(validateAgentMetadata({ agentRole: 'director', projectId: 'proj-a', sessionStatus: 'running', channelId: 'ch-123' })).toBe(true);
  });

  test('rejects director metadata without projectId', () => {
    expect(validateAgentMetadata({ agentRole: 'director' })).toBe(false);
    expect(validateAgentMetadata({ agentRole: 'director', projectId: '' })).toBe(false);
    expect(validateAgentMetadata({ agentRole: 'director', projectId: 42 })).toBe(false);
  });

  test('validates worker metadata', () => {
    expect(validateAgentMetadata({ agentRole: 'worker', workerMode: 'ephemeral' })).toBe(true);
    expect(validateAgentMetadata({ agentRole: 'worker', workerMode: 'persistent', branch: 'agent/alice/task-1' })).toBe(true);
  });

  test('rejects worker metadata without workerMode', () => {
    expect(validateAgentMetadata({ agentRole: 'worker' })).toBe(false);
  });

  test('validates steward metadata', () => {
    expect(validateAgentMetadata({ agentRole: 'steward', stewardFocus: 'merge' })).toBe(true);
    expect(validateAgentMetadata({ agentRole: 'steward', stewardFocus: 'docs', triggers: [{ type: 'cron', schedule: '0 2 * * *' }] })).toBe(true);
  });

  test('rejects steward metadata without stewardFocus', () => {
    expect(validateAgentMetadata({ agentRole: 'steward' })).toBe(false);
  });

  test('rejects steward metadata with invalid triggers', () => {
    expect(validateAgentMetadata({ agentRole: 'steward', stewardFocus: 'merge', triggers: [{ type: 'invalid' }] })).toBe(false);
  });

  test('rejects invalid agent metadata', () => {
    expect(validateAgentMetadata(null)).toBe(false);
    expect(validateAgentMetadata(undefined)).toBe(false);
    expect(validateAgentMetadata({})).toBe(false);
    expect(validateAgentMetadata({ agentRole: 'invalid' })).toBe(false);
  });

  test('validates agent metadata with maxConcurrentTasks', () => {
    expect(validateAgentMetadata({ agentRole: 'director', projectId: 'proj-a', maxConcurrentTasks: 2 })).toBe(true);
    expect(validateAgentMetadata({ agentRole: 'worker', workerMode: 'ephemeral', maxConcurrentTasks: 3 })).toBe(true);
  });

  test('rejects agent metadata with invalid maxConcurrentTasks', () => {
    expect(validateAgentMetadata({ agentRole: 'director', projectId: 'proj-a', maxConcurrentTasks: 'invalid' })).toBe(false);
  });

  test('validates agent metadata with projectFilter', () => {
    expect(validateAgentMetadata({
      agentRole: 'worker',
      workerMode: 'ephemeral',
      projectFilter: ['el-abc', 'el-def123'],
    })).toBe(true);
    expect(validateAgentMetadata({
      agentRole: 'director',
      projectId: 'proj-a',
      projectFilter: [],
    })).toBe(true);
  });

  test('rejects agent metadata with invalid projectFilter', () => {
    expect(validateAgentMetadata({
      agentRole: 'worker',
      workerMode: 'ephemeral',
      projectFilter: 'el-abc', // not an array
    })).toBe(false);
    expect(validateAgentMetadata({
      agentRole: 'worker',
      workerMode: 'ephemeral',
      projectFilter: ['not-a-valid-id'],
    })).toBe(false);
    expect(validateAgentMetadata({
      agentRole: 'director',
      projectFilter: [123 as unknown as string], // wrong element type
    })).toBe(false);
  });
});

describe('agentMatchesProject', () => {
  const globalMeta = { projectFilter: undefined };
  const emptyFilterMeta = { projectFilter: [] as ProjectId[] };
  const scopedMeta = {
    projectFilter: ['el-proja', 'el-projb'] as unknown as ProjectId[],
  };

  test('agent with undefined filter matches any task', () => {
    expect(agentMatchesProject(globalMeta, 'el-anything' as ProjectId)).toBe(true);
    expect(agentMatchesProject(globalMeta, undefined)).toBe(true);
  });

  test('agent with empty filter array matches any task (treated as global)', () => {
    expect(agentMatchesProject(emptyFilterMeta, 'el-anything' as ProjectId)).toBe(true);
    expect(agentMatchesProject(emptyFilterMeta, undefined)).toBe(true);
  });

  test('scoped agent matches tasks whose projectId is in the filter', () => {
    expect(agentMatchesProject(scopedMeta, 'el-proja' as ProjectId)).toBe(true);
    expect(agentMatchesProject(scopedMeta, 'el-projb' as ProjectId)).toBe(true);
  });

  test('scoped agent does not match tasks outside its filter', () => {
    expect(agentMatchesProject(scopedMeta, 'el-projc' as ProjectId)).toBe(false);
  });

  test('scoped agent does not pick up tasks without a projectId', () => {
    expect(agentMatchesProject(scopedMeta, undefined)).toBe(false);
  });

  test('handles undefined metadata safely (treats as global)', () => {
    expect(agentMatchesProject(undefined, 'el-anything' as ProjectId)).toBe(true);
    expect(agentMatchesProject(undefined, undefined)).toBe(true);
  });
});
