/**
 * useProjects — React Query hooks for the Projects registry.
 *
 * Wraps the /api/projects endpoints (backed by ~/.stoneforge/projects.json).
 */

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

// ============================================================================
// Types
// ============================================================================

export interface Project {
  id: string;
  name: string;
  path: string;
  registeredAt: string;
}

export interface CreateProjectInput {
  name: string;
  path: string;
}

export interface UpdateProjectInput {
  name?: string;
  path?: string;
}

interface ProjectsResponse {
  projects: Project[];
}

interface ProjectResponse {
  project: Project;
}

interface ErrorResponse {
  error?: { code?: string; message?: string };
}

// ============================================================================
// Query keys
// ============================================================================

export const PROJECTS_KEY = ['projects'] as const;
export const projectKey = (id: string) => ['projects', id] as const;

// ============================================================================
// Fetch helpers
// ============================================================================

const API_BASE = import.meta.env.VITE_API_URL ?? '';

/**
 * An error thrown by the projects API, carrying the server-provided error
 * code so callers can render code-specific UI without string-matching the
 * message.
 */
export class ProjectApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string
  ) {
    super(message);
    this.name = 'ProjectApiError';
  }
}

async function parseErrorResponse(res: Response): Promise<ProjectApiError> {
  let code = 'UNKNOWN';
  let message = `HTTP ${res.status}`;
  try {
    const json = (await res.json()) as ErrorResponse;
    code = json.error?.code ?? code;
    message = json.error?.message ?? message;
  } catch {
    // Body was not JSON — keep generic message.
  }
  return new ProjectApiError(res.status, code, message);
}

async function fetchProjects(): Promise<Project[]> {
  const res = await fetch(`${API_BASE}/api/projects`);
  if (!res.ok) throw await parseErrorResponse(res);
  const data = (await res.json()) as ProjectsResponse;
  return data.projects;
}

async function createProject(input: CreateProjectInput): Promise<Project> {
  const res = await fetch(`${API_BASE}/api/projects`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
  if (!res.ok) throw await parseErrorResponse(res);
  const data = (await res.json()) as ProjectResponse;
  return data.project;
}

async function updateProject(id: string, input: UpdateProjectInput): Promise<Project> {
  const res = await fetch(`${API_BASE}/api/projects/${id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
  if (!res.ok) throw await parseErrorResponse(res);
  const data = (await res.json()) as ProjectResponse;
  return data.project;
}

async function deleteProject(id: string): Promise<void> {
  const res = await fetch(`${API_BASE}/api/projects/${id}`, { method: 'DELETE' });
  if (!res.ok) throw await parseErrorResponse(res);
}

// ============================================================================
// Hooks
// ============================================================================

export function useProjects() {
  return useQuery({
    queryKey: PROJECTS_KEY,
    queryFn: fetchProjects,
    // The registry rarely changes; keep the polling cheap.
    refetchInterval: 15_000,
  });
}

export function useCreateProject() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: createProject,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: PROJECTS_KEY });
    },
  });
}

export function useUpdateProject() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...input }: UpdateProjectInput & { id: string }) =>
      updateProject(id, input),
    onSuccess: (project) => {
      queryClient.invalidateQueries({ queryKey: PROJECTS_KEY });
      queryClient.invalidateQueries({ queryKey: projectKey(project.id) });
    },
  });
}

export function useDeleteProject() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: deleteProject,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: PROJECTS_KEY });
    },
  });
}
