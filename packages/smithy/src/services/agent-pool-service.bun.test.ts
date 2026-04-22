/**
 * Agent Pool Service Tests
 *
 * Focus: global default + optional per-project override.
 *
 * - A pool with no `projectId` is a **global** concurrency ceiling that
 *   applies to every spawn.
 * - A pool with a `projectId` is a **per-project override** layered on top;
 *   it only applies when the spawn is for a task in that project.
 * - `canSpawn` evaluates global pools first, then per-project pools, and
 *   rejects at the first one that is at capacity.
 *
 * @module
 */

import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import * as fs from 'fs';
import { EventEmitter } from 'node:events';
import { createStorage, initializeSchema } from '@stoneforge/storage';
import { createQuarryAPI, type QuarryAPI } from '@stoneforge/quarry';
import { asProjectId, type EntityId, type ProjectId } from '@stoneforge/core';
import { createAgentRegistry, type AgentRegistry, type AgentEntity } from './agent-registry.js';
import { createAgentPoolService, type AgentPoolService } from './agent-pool-service.js';
import type { SessionManager, SessionRecord } from '../runtime/session-manager.js';

// ============================================================================
// Minimal mocks — the pool service only reads listSessions from SessionManager
// ============================================================================

function createStubSessionManager(): SessionManager {
  return {
    listSessions: () => [] as SessionRecord[],
    startSession: async () => ({ session: {} as SessionRecord, events: new EventEmitter() }),
    getActiveSession: () => null,
    stopSession: async () => {},
    suspendSession: async () => {},
    resumeSession: async () => ({ session: {} as SessionRecord, events: new EventEmitter() }),
    getSession: () => undefined,
    messageSession: async () => ({ success: true }),
    getSessionHistory: () => [],
    pruneInactiveSessions: () => 0,
    reconcileOnStartup: async () => ({ reconciled: 0, errors: [] }),
    on: () => {},
    off: () => {},
    emit: () => {},
  } as unknown as SessionManager;
}

// ============================================================================
// Fixture helpers
// ============================================================================

interface Fixture {
  api: QuarryAPI;
  registry: AgentRegistry;
  poolService: AgentPoolService;
  systemEntity: EntityId;
  dbPath: string;
}

async function setup(): Promise<Fixture> {
  const dbPath = `/tmp/agent-pool-test-${Date.now()}-${Math.random().toString(36).slice(2)}.db`;
  const storage = createStorage(dbPath);
  initializeSchema(storage);
  const api = createQuarryAPI(storage);

  const { createEntity, EntityTypeValue } = await import('@stoneforge/core');
  const sys = await createEntity({
    name: 'test-system',
    entityType: EntityTypeValue.SYSTEM,
    createdBy: 'system:test' as EntityId,
  });
  const savedSys = await api.create(sys as unknown as Record<string, unknown> & { createdBy: EntityId });
  const systemEntity = savedSys.id as unknown as EntityId;

  const registry = createAgentRegistry(api);
  const sessionManager = createStubSessionManager();
  const poolService = createAgentPoolService(api, sessionManager, registry);

  return { api, registry, poolService, systemEntity, dbPath };
}

function teardown(dbPath: string): void {
  if (fs.existsSync(dbPath)) {
    try {
      fs.unlinkSync(dbPath);
    } catch {
      // best-effort cleanup
    }
  }
}

async function registerWorker(
  registry: AgentRegistry,
  systemEntity: EntityId,
  name: string
): Promise<AgentEntity> {
  return registry.registerWorker({
    name,
    workerMode: 'ephemeral',
    createdBy: systemEntity,
  });
}

// ============================================================================
// Tests
// ============================================================================

describe('AgentPoolService — projectId scoping', () => {
  let fx: Fixture;

  beforeEach(async () => {
    fx = await setup();
  });

  afterEach(() => {
    teardown(fx.dbPath);
  });

  test('creates a global pool when projectId is omitted', async () => {
    const pool = await fx.poolService.createPool({
      name: 'global-pool',
      maxSize: 3,
      createdBy: fx.systemEntity,
    });

    expect(pool.config.projectId).toBeUndefined();
  });

  test('creates a per-project pool when projectId is set', async () => {
    const projectId = asProjectId('el-proja');
    const pool = await fx.poolService.createPool({
      name: 'proja-pool',
      maxSize: 2,
      projectId,
      createdBy: fx.systemEntity,
    });

    expect(pool.config.projectId).toBe(projectId);
  });

  test('rejects invalid projectId at create time', async () => {
    await expect(
      fx.poolService.createPool({
        name: 'bad-pool',
        maxSize: 2,
        projectId: 'not-a-valid-id' as unknown as ProjectId,
        createdBy: fx.systemEntity,
      })
    ).rejects.toThrow(/Invalid projectId/);
  });

  test('listPools filters by projectId=null (global only)', async () => {
    await fx.poolService.createPool({ name: 'g1', maxSize: 1, createdBy: fx.systemEntity });
    await fx.poolService.createPool({
      name: 'p1',
      maxSize: 1,
      projectId: asProjectId('el-proja'),
      createdBy: fx.systemEntity,
    });

    const globalsOnly = await fx.poolService.listPools({ projectId: null });
    expect(globalsOnly.map((p) => p.config.name)).toEqual(['g1']);
  });

  test('listPools filters by specific projectId', async () => {
    const projA = asProjectId('el-proja');
    const projB = asProjectId('el-projb');
    await fx.poolService.createPool({ name: 'g1', maxSize: 1, createdBy: fx.systemEntity });
    await fx.poolService.createPool({ name: 'a1', maxSize: 1, projectId: projA, createdBy: fx.systemEntity });
    await fx.poolService.createPool({ name: 'b1', maxSize: 1, projectId: projB, createdBy: fx.systemEntity });

    const onlyA = await fx.poolService.listPools({ projectId: projA });
    expect(onlyA.map((p) => p.config.name)).toEqual(['a1']);
  });
});

describe('AgentPoolService — getPoolsForAgentType scope filter', () => {
  let fx: Fixture;

  beforeEach(async () => {
    fx = await setup();
  });

  afterEach(() => {
    teardown(fx.dbPath);
  });

  test('global pool applies to every spawn request', async () => {
    await fx.poolService.createPool({ name: 'g1', maxSize: 5, createdBy: fx.systemEntity });

    const pools = await fx.poolService.getPoolsForAgentType('worker', 'ephemeral');
    expect(pools.map((p) => p.config.name)).toEqual(['g1']);
  });

  test('per-project pool applies only to matching projectId', async () => {
    const projA = asProjectId('el-proja');
    const projB = asProjectId('el-projb');
    await fx.poolService.createPool({ name: 'a1', maxSize: 5, projectId: projA, createdBy: fx.systemEntity });
    await fx.poolService.createPool({ name: 'b1', maxSize: 5, projectId: projB, createdBy: fx.systemEntity });

    const forA = await fx.poolService.getPoolsForAgentType('worker', 'ephemeral', undefined, projA);
    expect(forA.map((p) => p.config.name)).toEqual(['a1']);

    const forB = await fx.poolService.getPoolsForAgentType('worker', 'ephemeral', undefined, projB);
    expect(forB.map((p) => p.config.name)).toEqual(['b1']);

    const forNone = await fx.poolService.getPoolsForAgentType('worker', 'ephemeral');
    expect(forNone).toEqual([]);
  });

  test('returns global pools before per-project pools', async () => {
    const projA = asProjectId('el-proja');
    await fx.poolService.createPool({ name: 'globalCeiling', maxSize: 5, createdBy: fx.systemEntity });
    await fx.poolService.createPool({ name: 'aOverride', maxSize: 2, projectId: projA, createdBy: fx.systemEntity });

    const pools = await fx.poolService.getPoolsForAgentType('worker', 'ephemeral', undefined, projA);
    expect(pools.map((p) => p.config.name)).toEqual(['globalCeiling', 'aOverride']);
  });
});

describe('AgentPoolService — canSpawn with global + per-project pools', () => {
  let fx: Fixture;

  beforeEach(async () => {
    fx = await setup();
  });

  afterEach(() => {
    teardown(fx.dbPath);
  });

  test('allows spawn when there are no pools', async () => {
    const worker = await registerWorker(fx.registry, fx.systemEntity, 'noPoolWorker');

    const result = await fx.poolService.canSpawn({
      role: 'worker',
      workerMode: 'ephemeral',
      agentId: worker.id as EntityId,
    });

    expect(result.canSpawn).toBe(true);
  });

  test('global ceiling blocks a spawn when full', async () => {
    await fx.poolService.createPool({ name: 'ceiling', maxSize: 1, createdBy: fx.systemEntity });
    const w1 = await registerWorker(fx.registry, fx.systemEntity, 'w1');
    const w2 = await registerWorker(fx.registry, fx.systemEntity, 'w2');

    await fx.poolService.onAgentSpawned(w1.id as EntityId);

    const result = await fx.poolService.canSpawn({
      role: 'worker',
      workerMode: 'ephemeral',
      agentId: w2.id as EntityId,
    });

    expect(result.canSpawn).toBe(false);
    expect(result.poolName).toBe('ceiling');
    expect(result.reason).toMatch(/global/);
  });

  test('per-project pool blocks spawn only for that project', async () => {
    const projA = asProjectId('el-proja');
    const projB = asProjectId('el-projb');

    // Global has plenty of room; project A override is size 1
    await fx.poolService.createPool({ name: 'ceiling', maxSize: 10, createdBy: fx.systemEntity });
    await fx.poolService.createPool({ name: 'aOverride', maxSize: 1, projectId: projA, createdBy: fx.systemEntity });

    const wA1 = await registerWorker(fx.registry, fx.systemEntity, 'wA1');
    const wA2 = await registerWorker(fx.registry, fx.systemEntity, 'wA2');
    const wB1 = await registerWorker(fx.registry, fx.systemEntity, 'wB1');

    // Fill the project A override
    await fx.poolService.onAgentSpawned(wA1.id as EntityId, projA);

    // Second spawn into project A is blocked by the override
    const blocked = await fx.poolService.canSpawn({
      role: 'worker',
      workerMode: 'ephemeral',
      agentId: wA2.id as EntityId,
      projectId: projA,
    });
    expect(blocked.canSpawn).toBe(false);
    expect(blocked.poolName).toBe('aOverride');

    // Spawn into project B is unaffected
    const allowedB = await fx.poolService.canSpawn({
      role: 'worker',
      workerMode: 'ephemeral',
      agentId: wB1.id as EntityId,
      projectId: projB,
    });
    expect(allowedB.canSpawn).toBe(true);
  });

  test('global ceiling is evaluated before per-project override', async () => {
    const projA = asProjectId('el-proja');

    // Global is the tighter constraint — it should be the one to reject first.
    await fx.poolService.createPool({ name: 'ceiling', maxSize: 1, createdBy: fx.systemEntity });
    await fx.poolService.createPool({ name: 'aOverride', maxSize: 10, projectId: projA, createdBy: fx.systemEntity });

    const w1 = await registerWorker(fx.registry, fx.systemEntity, 'w1');
    const w2 = await registerWorker(fx.registry, fx.systemEntity, 'w2');

    await fx.poolService.onAgentSpawned(w1.id as EntityId, projA);

    const result = await fx.poolService.canSpawn({
      role: 'worker',
      workerMode: 'ephemeral',
      agentId: w2.id as EntityId,
      projectId: projA,
    });

    expect(result.canSpawn).toBe(false);
    // Rejection should name the global ceiling, not the project override.
    expect(result.poolName).toBe('ceiling');
  });

  test('reports the most specific pool when spawn is allowed', async () => {
    const projA = asProjectId('el-proja');
    await fx.poolService.createPool({ name: 'ceiling', maxSize: 10, createdBy: fx.systemEntity });
    await fx.poolService.createPool({ name: 'aOverride', maxSize: 5, projectId: projA, createdBy: fx.systemEntity });

    const w = await registerWorker(fx.registry, fx.systemEntity, 'w');
    const result = await fx.poolService.canSpawn({
      role: 'worker',
      workerMode: 'ephemeral',
      agentId: w.id as EntityId,
      projectId: projA,
    });

    expect(result.canSpawn).toBe(true);
    // When both pools have room, the per-project pool is the tightest scope.
    expect(result.poolName).toBe('aOverride');
  });

  test('session end releases both global and per-project pool slots', async () => {
    const projA = asProjectId('el-proja');
    await fx.poolService.createPool({ name: 'ceiling', maxSize: 2, createdBy: fx.systemEntity });
    await fx.poolService.createPool({ name: 'aOverride', maxSize: 1, projectId: projA, createdBy: fx.systemEntity });

    const w1 = await registerWorker(fx.registry, fx.systemEntity, 'w1');
    const w2 = await registerWorker(fx.registry, fx.systemEntity, 'w2');

    // Occupy both pools
    await fx.poolService.onAgentSpawned(w1.id as EntityId, projA);

    // Project A override is now full — second project-A spawn should be blocked.
    const blockedBefore = await fx.poolService.canSpawn({
      role: 'worker',
      workerMode: 'ephemeral',
      agentId: w2.id as EntityId,
      projectId: projA,
    });
    expect(blockedBefore.canSpawn).toBe(false);

    // Session ends — both pools should decrement.
    await fx.poolService.onAgentSessionEnded(w1.id as EntityId);

    const allowedAfter = await fx.poolService.canSpawn({
      role: 'worker',
      workerMode: 'ephemeral',
      agentId: w2.id as EntityId,
      projectId: projA,
    });
    expect(allowedAfter.canSpawn).toBe(true);
  });

  test('workspace-level (projectless) tasks are governed only by global pools', async () => {
    const projA = asProjectId('el-proja');
    await fx.poolService.createPool({ name: 'ceiling', maxSize: 5, createdBy: fx.systemEntity });
    await fx.poolService.createPool({ name: 'aOverride', maxSize: 1, projectId: projA, createdBy: fx.systemEntity });

    // Fill project A override via a project-A spawn.
    const wA = await registerWorker(fx.registry, fx.systemEntity, 'wA');
    await fx.poolService.onAgentSpawned(wA.id as EntityId, projA);

    // A spawn without a projectId should not hit the project-A override.
    const wNoProj = await registerWorker(fx.registry, fx.systemEntity, 'wNoProj');
    const result = await fx.poolService.canSpawn({
      role: 'worker',
      workerMode: 'ephemeral',
      agentId: wNoProj.id as EntityId,
    });
    expect(result.canSpawn).toBe(true);
    expect(result.poolName).toBe('ceiling');
  });
});
