import { describe, expect, test } from 'bun:test';
import {
  ElementId,
  EntityId,
  ElementType,
  Timestamp,
} from './element.js';
import {
  MAX_PROJECT_NAME_LENGTH,
  MAX_PROJECT_PATH_LENGTH,
  Project,
  ProjectId,
  asProjectId,
  createProject,
  findByName,
  findByPath,
  getProjectDisplayName,
  isProject,
  isValidProjectId,
  isValidProjectName,
  isValidProjectPath,
  sortByName,
  updateProject,
  validateProject,
  validateProjectId,
  validateProjectName,
  validateProjectPath,
} from './project.js';
import { ValidationError } from '../errors/error.js';

function fakeProject(overrides: Partial<Project> = {}): Project {
  return {
    id: 'el-abc123' as ProjectId,
    type: ElementType.PROJECT,
    createdAt: '2026-01-01T00:00:00.000Z' as Timestamp,
    updatedAt: '2026-01-01T00:00:00.000Z' as Timestamp,
    createdBy: 'el-entity1' as EntityId,
    tags: [],
    metadata: {},
    name: 'Stoneforge',
    path: '/home/user/stoneforge',
    ...overrides,
  };
}

describe('ElementType.PROJECT', () => {
  test('is registered as a valid element type', () => {
    expect(ElementType.PROJECT).toBe('project');
  });
});

describe('isValidProjectName', () => {
  test('accepts valid names', () => {
    expect(isValidProjectName('Stoneforge')).toBe(true);
    expect(isValidProjectName('A')).toBe(true);
    expect(isValidProjectName('a'.repeat(MAX_PROJECT_NAME_LENGTH))).toBe(true);
  });

  test('rejects empty and oversized names', () => {
    expect(isValidProjectName('')).toBe(false);
    expect(isValidProjectName('   ')).toBe(false);
    expect(isValidProjectName('a'.repeat(MAX_PROJECT_NAME_LENGTH + 1))).toBe(false);
  });

  test('rejects non-string', () => {
    expect(isValidProjectName(null)).toBe(false);
    expect(isValidProjectName(123)).toBe(false);
  });
});

describe('validateProjectName', () => {
  test('trims and returns valid name', () => {
    expect(validateProjectName('  Stoneforge  ')).toBe('Stoneforge');
  });

  test('throws on non-string', () => {
    expect(() => validateProjectName(123)).toThrow(ValidationError);
  });

  test('throws on empty', () => {
    expect(() => validateProjectName('   ')).toThrow(ValidationError);
  });

  test('throws when too long', () => {
    expect(() => validateProjectName('a'.repeat(MAX_PROJECT_NAME_LENGTH + 1))).toThrow(
      ValidationError
    );
  });
});

describe('isValidProjectPath', () => {
  test('accepts valid paths', () => {
    expect(isValidProjectPath('/home/user/stoneforge')).toBe(true);
    expect(isValidProjectPath('C:\\Users\\user\\stoneforge')).toBe(true);
    expect(isValidProjectPath('.')).toBe(true);
  });

  test('rejects empty / oversized', () => {
    expect(isValidProjectPath('')).toBe(false);
    expect(isValidProjectPath('   ')).toBe(false);
    expect(isValidProjectPath('a'.repeat(MAX_PROJECT_PATH_LENGTH + 1))).toBe(false);
  });

  test('rejects non-string', () => {
    expect(isValidProjectPath(null)).toBe(false);
  });
});

describe('validateProjectPath', () => {
  test('returns trimmed path', () => {
    expect(validateProjectPath('  /a/b  ')).toBe('/a/b');
  });

  test('throws on empty/invalid', () => {
    expect(() => validateProjectPath('')).toThrow(ValidationError);
    expect(() => validateProjectPath(42)).toThrow(ValidationError);
    expect(() => validateProjectPath('a'.repeat(MAX_PROJECT_PATH_LENGTH + 1))).toThrow(
      ValidationError
    );
  });
});

describe('isValidProjectId / validateProjectId', () => {
  test('accepts well-formed ids', () => {
    expect(isValidProjectId('el-abc')).toBe(true);
    expect(isValidProjectId('el-12345678')).toBe(true);
  });

  test('rejects malformed ids', () => {
    expect(isValidProjectId('abc-123')).toBe(false);
    expect(isValidProjectId('el-')).toBe(false);
    expect(isValidProjectId('EL-ABC')).toBe(false);
    expect(isValidProjectId(42)).toBe(false);
  });

  test('validateProjectId returns branded id', () => {
    const id = validateProjectId('el-abc123');
    expect(id).toBe('el-abc123' as ProjectId);
  });

  test('validateProjectId throws on bad id', () => {
    expect(() => validateProjectId('bad')).toThrow(ValidationError);
  });
});

describe('asProjectId', () => {
  test('brands a raw string', () => {
    const id: ProjectId = asProjectId('el-xyz');
    expect(id).toBe('el-xyz' as ProjectId);
  });
});

describe('isProject / validateProject', () => {
  test('accepts a valid project', () => {
    const project = fakeProject();
    expect(isProject(project)).toBe(true);
    expect(validateProject(project)).toBe(project);
  });

  test('rejects wrong type discriminator', () => {
    const notProject = { ...fakeProject(), type: 'task' };
    expect(isProject(notProject)).toBe(false);
    expect(() => validateProject(notProject)).toThrow(ValidationError);
  });

  test('rejects missing name', () => {
    const missing = { ...fakeProject(), name: '' } as unknown;
    expect(isProject(missing)).toBe(false);
    expect(() => validateProject(missing)).toThrow(ValidationError);
  });

  test('rejects missing path', () => {
    const missing = { ...fakeProject(), path: '' } as unknown;
    expect(isProject(missing)).toBe(false);
    expect(() => validateProject(missing)).toThrow(ValidationError);
  });

  test('rejects non-object', () => {
    expect(isProject(null)).toBe(false);
    expect(isProject('string')).toBe(false);
    expect(() => validateProject(null)).toThrow(ValidationError);
  });
});

describe('createProject', () => {
  test('creates a valid project with generated id and timestamps', async () => {
    const project = await createProject({
      name: 'Stoneforge',
      path: '/home/user/stoneforge',
      createdBy: 'el-entity1' as EntityId,
    });

    expect(project.type).toBe(ElementType.PROJECT);
    expect(project.name).toBe('Stoneforge');
    expect(project.path).toBe('/home/user/stoneforge');
    expect(project.createdBy).toBe('el-entity1' as EntityId);
    expect(project.tags).toEqual([]);
    expect(project.metadata).toEqual({});
    expect(typeof project.id).toBe('string');
    expect(project.id).toMatch(/^el-[0-9a-z]{3,8}$/);
    expect(project.createdAt).toBe(project.updatedAt);
    expect(isProject(project)).toBe(true);
  });

  test('trims name and path inputs', async () => {
    const project = await createProject({
      name: '  Stoneforge  ',
      path: '  /home/user/stoneforge  ',
      createdBy: 'el-entity1' as EntityId,
    });
    expect(project.name).toBe('Stoneforge');
    expect(project.path).toBe('/home/user/stoneforge');
  });

  test('propagates tags and metadata', async () => {
    const project = await createProject({
      name: 'p',
      path: '/p',
      createdBy: 'el-entity1' as EntityId,
      tags: ['main'],
      metadata: { color: 'blue' },
    });
    expect(project.tags).toEqual(['main']);
    expect(project.metadata).toEqual({ color: 'blue' });
  });

  test('different (name, path) pairs produce different ids', async () => {
    const createdBy = 'el-entity1' as EntityId;
    const a = await createProject({ name: 'p', path: '/one', createdBy });
    const b = await createProject({ name: 'p', path: '/two', createdBy });
    expect(a.id).not.toBe(b.id);
  });

  test('throws on invalid input', async () => {
    await expect(
      createProject({ name: '', path: '/p', createdBy: 'el-e' as EntityId })
    ).rejects.toThrow(ValidationError);
    await expect(
      createProject({ name: 'p', path: '', createdBy: 'el-e' as EntityId })
    ).rejects.toThrow(ValidationError);
  });
});

describe('updateProject', () => {
  test('updates name and path and advances updatedAt', async () => {
    const original = fakeProject({
      createdAt: '2026-01-01T00:00:00.000Z' as Timestamp,
      updatedAt: '2026-01-01T00:00:00.000Z' as Timestamp,
    });

    const updated = updateProject(original, { name: 'New', path: '/new' });
    expect(updated.name).toBe('New');
    expect(updated.path).toBe('/new');
    expect(updated.id).toBe(original.id);
    expect(updated.createdAt).toBe(original.createdAt);
    expect(updated.updatedAt >= original.updatedAt).toBe(true);
  });

  test('partial updates leave other fields unchanged', () => {
    const original = fakeProject();
    const updated = updateProject(original, { name: 'Renamed' });
    expect(updated.name).toBe('Renamed');
    expect(updated.path).toBe(original.path);
  });

  test('throws on invalid update input', () => {
    const original = fakeProject();
    expect(() => updateProject(original, { name: '' })).toThrow(ValidationError);
    expect(() => updateProject(original, { path: '' })).toThrow(ValidationError);
  });
});

describe('utility helpers', () => {
  test('getProjectDisplayName returns the name', () => {
    expect(getProjectDisplayName(fakeProject({ name: 'Name' }))).toBe('Name');
  });

  test('findByPath exact match', () => {
    const a = fakeProject({ id: 'el-aaa' as ProjectId, path: '/a' });
    const b = fakeProject({ id: 'el-bbb' as ProjectId, path: '/b' });
    expect(findByPath([a, b], '/b')?.id).toBe('el-bbb' as ProjectId);
    expect(findByPath([a, b], '/missing')).toBeUndefined();
  });

  test('findByName is case-insensitive', () => {
    const a = fakeProject({ id: 'el-aaa' as ProjectId, name: 'Stoneforge' });
    const b = fakeProject({ id: 'el-bbb' as ProjectId, name: 'Other' });
    expect(findByName([a, b], 'stoneforge')?.id).toBe('el-aaa' as ProjectId);
    expect(findByName([a, b], 'Nope')).toBeUndefined();
  });

  test('sortByName sorts alphabetically', () => {
    const a = fakeProject({ id: 'el-a' as ProjectId, name: 'Bravo' });
    const b = fakeProject({ id: 'el-b' as ProjectId, name: 'Alpha' });
    const sorted = sortByName([a, b]);
    expect(sorted[0].name).toBe('Alpha');
    expect(sorted[1].name).toBe('Bravo');

    const desc = sortByName([a, b], false);
    expect(desc[0].name).toBe('Bravo');
  });
});

// Smoke test: ensure we didn't break any generic element helpers
describe('interop with Element base', () => {
  test('project satisfies the Element interface', () => {
    const project = fakeProject();
    // These fields are defined by Element
    const _id: ElementId = project.id;
    expect(project.type).toBe(ElementType.PROJECT);
    expect(Array.isArray(project.tags)).toBe(true);
    expect(typeof project.metadata).toBe('object');
    expect(_id).toBe(project.id);
  });
});
