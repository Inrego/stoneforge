/**
 * Projects Page — registry of Stoneforge workspaces known to this machine.
 *
 * Lists entries from ~/.stoneforge/projects.json (via /api/projects) and
 * exposes add / edit / remove flows. This is the "Projects page in web
 * dashboard" surface for task el-65c; richer per-project views arrive in
 * downstream multi-project tasks.
 */

import { useMemo, useState } from 'react';
import { AlertCircle, FolderGit2, Loader2, Plus, RefreshCw } from 'lucide-react';
import {
  DeleteProjectDialog,
  ProjectFormDialog,
  ProjectRow,
} from '../../components/project';
import { useProjects, type Project } from '../../api/hooks/useProjects';

export function ProjectsPage() {
  const { data: projects, isLoading, isError, error, refetch, isFetching } = useProjects();

  const [isCreateOpen, setCreateOpen] = useState(false);
  const [editTarget, setEditTarget] = useState<Project | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Project | null>(null);

  const sorted = useMemo(() => {
    if (!projects) return [];
    // Sort by name for a stable, predictable list.
    return [...projects].sort((a, b) => a.name.localeCompare(b.name));
  }, [projects]);

  const hasProjects = sorted.length > 0;

  return (
    <div
      className="flex flex-col h-full overflow-hidden"
      data-testid="projects-page"
    >
      {/* Header */}
      <div className="flex items-center justify-between px-6 py-4 border-b border-[var(--color-border)]">
        <div>
          <h1
            className="text-xl font-semibold text-[var(--color-text)]"
            data-testid="projects-page-title"
          >
            Projects
          </h1>
          <p className="text-sm text-[var(--color-text-secondary)]">
            Stoneforge workspaces registered on this machine.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => {
              void refetch();
            }}
            disabled={isFetching}
            className="p-2 rounded-lg text-[var(--color-text-tertiary)] hover:text-[var(--color-text)] hover:bg-[var(--color-surface-hover)] disabled:opacity-50 transition-colors"
            aria-label="Refresh projects"
            data-testid="projects-refresh"
          >
            <RefreshCw className={`w-4 h-4 ${isFetching ? 'animate-spin' : ''}`} />
          </button>
          <button
            type="button"
            onClick={() => setCreateOpen(true)}
            className="flex items-center gap-2 px-3 py-2 text-sm font-medium text-white bg-[var(--color-primary)] hover:bg-[var(--color-primary-hover)] rounded-lg transition-colors"
            data-testid="projects-create"
          >
            <Plus className="w-4 h-4" />
            Register project
          </button>
        </div>
      </div>

      {/* Body */}
      <div className="flex-1 overflow-y-auto">
        <div className="max-w-3xl mx-auto px-6 py-6 space-y-3">
          {isError && (
            <div
              role="alert"
              className="flex items-start gap-2 px-3 py-2 text-sm text-red-700 dark:text-red-300 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg"
              data-testid="projects-error"
            >
              <AlertCircle className="w-4 h-4 flex-shrink-0 mt-0.5" />
              <span className="break-words">
                Failed to load projects
                {error instanceof Error ? `: ${error.message}` : ''}
              </span>
            </div>
          )}

          {isLoading && (
            <div
              className="flex items-center justify-center py-12 text-[var(--color-text-tertiary)]"
              data-testid="projects-loading"
            >
              <Loader2 className="w-5 h-5 animate-spin" />
            </div>
          )}

          {!isLoading && !hasProjects && !isError && (
            <div
              className="flex flex-col items-center justify-center py-16 text-center"
              data-testid="projects-empty"
            >
              <FolderGit2 className="w-10 h-10 text-[var(--color-text-tertiary)] mb-3" />
              <h2 className="text-base font-medium text-[var(--color-text)]">
                No projects registered yet
              </h2>
              <p className="mt-1 text-sm text-[var(--color-text-secondary)] max-w-sm">
                Register a Stoneforge workspace to have it show up across the
                dashboard.
              </p>
              <button
                type="button"
                onClick={() => setCreateOpen(true)}
                className="mt-4 flex items-center gap-2 px-3 py-2 text-sm font-medium text-white bg-[var(--color-primary)] hover:bg-[var(--color-primary-hover)] rounded-lg transition-colors"
                data-testid="projects-empty-create"
              >
                <Plus className="w-4 h-4" />
                Register project
              </button>
            </div>
          )}

          {hasProjects && (
            <ul className="space-y-2" data-testid="projects-list">
              {sorted.map((project) => (
                <li key={project.id}>
                  <ProjectRow
                    project={project}
                    onEdit={setEditTarget}
                    onDelete={setDeleteTarget}
                  />
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      <ProjectFormDialog
        isOpen={isCreateOpen}
        onClose={() => setCreateOpen(false)}
      />
      <ProjectFormDialog
        isOpen={editTarget !== null}
        project={editTarget ?? undefined}
        onClose={() => setEditTarget(null)}
      />
      <DeleteProjectDialog
        isOpen={deleteTarget !== null}
        project={deleteTarget}
        onClose={() => setDeleteTarget(null)}
      />
    </div>
  );
}
