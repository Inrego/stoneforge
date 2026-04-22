/**
 * Projects module
 *
 * Minimal foundation for multi-project support: registry + global SQLite
 * cache rebuild. Fuller semantics (Project element type, projectId scoping,
 * server-side DB resolution) arrive in downstream tasks.
 */

export {
  GLOBAL_STONEFORGE_DIR,
  PROJECTS_REGISTRY_FILE,
  GLOBAL_DB_FILE,
  CURRENT_REGISTRY_VERSION,
  getGlobalStoneforgeDir,
  getRegistryPath,
  getGlobalDbPath,
  readRegistry,
  writeRegistry,
  addOrUpdateProject,
  removeProject,
  findProjectByPath,
  findProjectById,
  validateProjectPath,
  ProjectPathError,
  ProjectRegistryError,
  type ProjectRegistry,
  type ProjectRegistryEntry,
  type AddProjectInput,
  type AddProjectResult,
  type RemoveProjectResult,
} from './registry.js';

export {
  rebuildGlobalCache,
  type RebuildInput,
  type RebuildResult,
  type SkippedProject,
} from './rebuild.js';
