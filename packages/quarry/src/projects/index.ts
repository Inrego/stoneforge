/**
 * Projects module — public surface.
 *
 * Re-exports the registry service and the underlying pure helpers used
 * by the CLI, the server boot hook, and tests.
 */

export {
  // Constants
  CURRENT_REGISTRY_VERSION,
  GLOBAL_STONEFORGE_DIR,
  PROJECTS_REGISTRY_FILE,
  // Path helpers
  getGlobalStoneforgeDir,
  getRegistryPath,
  // Validation
  validateProjectPath,
  // Read / write
  readRegistry,
  writeRegistry,
  // Pure CRUD helpers
  addProject,
  updateProject,
  removeProject,
  findProjectById,
  findProjectByPath,
  emptyRegistry,
  // Errors
  ProjectPathError,
  ProjectRegistryError,
  // Types
  type Project,
  type ProjectRegistry,
  type CreateProjectInput,
  type UpdateProjectInput,
} from './registry.js';

export {
  createProjectRegistryService,
  tryLoadProjectRegistryService,
  loadProjectRegistryForBoot,
  type ProjectRegistryService,
  type ProjectRegistryServiceOptions,
} from './service.js';
