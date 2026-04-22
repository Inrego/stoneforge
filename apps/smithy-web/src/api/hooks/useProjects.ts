/**
 * useProjects — React Query hooks for the global Projects registry.
 *
 * Wraps the `/api/projects` endpoints (backed by
 * `~/.stoneforge/projects.json`) used by the Projects page.
 */

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

// ============================================================================
// Types
// ============================================================================

/** Registered project entry mirroring the quarry registry shape. */
export interface Project {
  id: string;
  name: string;
  /** Absolute filesystem path to the project root. */
  path: string;
  /** ISO timestamp of first registration. */
  registeredAt: string;
}

export interface CreateProjectInput {
  name: string;
  path: string;
}

export interface UpdateProjectInput {
  name: string;
}

interface ProjectsResponse {
  projects: Project[];
}

interface ProjectResponse {
  project: Project;
}

interface ApiErrorBody {
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

const API_BASE = '/api';

/**
 * Error thrown by the projects API. Carries the server's stable error
 * `code` so the UI can render code-specific messages without string
 * matching the human-readable text.
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
    const body = (await res.json()) as ApiErrorBody;
    code = body.error?.code ?? code;
    message = body.error?.message ?? message;
  } catch {
    // Body was not JSON — keep the generic message.
  }
  return new ProjectApiError(res.status, code, message);
}

async function fetchProjects(): Promise<Project[]> {
  const res = await fetch(`${API_BASE}/projects`);
  if (!res.ok) throw await parseErrorResponse(res);
  const body = (await res.json()) as ProjectsResponse;
  return body.projects;
}

async function createProject(input: CreateProjectInput): Promise<Project> {
  const res = await fetch(`${API_BASE}/projects`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
  if (!res.ok) throw await parseErrorResponse(res);
  const body = (await res.json()) as ProjectResponse;
  return body.project;
}

async function updateProject(id: string, input: UpdateProjectInput): Promise<Project> {
  const res = await fetch(`${API_BASE}/projects/${id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
  if (!res.ok) throw await parseErrorResponse(res);
  const body = (await res.json()) as ProjectResponse;
  return body.project;
}

async function deleteProject(id: string): Promise<void> {
  const res = await fetch(`${API_BASE}/projects/${id}`, { method: 'DELETE' });
  if (!res.ok) throw await parseErrorResponse(res);
}

// ============================================================================
// Hooks
// ============================================================================

/** Lists all registered projects. Polls every 15 s — the file rarely changes. */
export function useProjects() {
  return useQuery({
    queryKey: PROJECTS_KEY,
    queryFn: fetchProjects,
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
    mutationFn: ({ id, name }: UpdateProjectInput & { id: string }) =>
      updateProject(id, { name }),
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
