/**
 * Projects Page — manage the global Stoneforge projects registry.
 *
 * Lists projects registered in `~/.stoneforge/projects.json` and exposes
 * create / rename / unregister actions backed by `/api/projects`.
 */

import { useMemo, useState } from 'react';
import {
  AlertCircle,
  FolderGit2,
  FolderPlus,
  Loader2,
  Search,
} from 'lucide-react';
import {
  ProjectApiError,
  useDeleteProject,
  useProjects,
  type Project,
} from '../../api/hooks/useProjects';
import {
  DeleteProjectDialog,
  ProjectFormDialog,
  ProjectRow,
  type ProjectFormMode,
} from '../../components/project';

export function ProjectsPage() {
  const { data: projects, isLoading, error, refetch } = useProjects();
  const deleteMutation = useDeleteProject();

  const [searchQuery, setSearchQuery] = useState('');
  const [formDialog, setFormDialog] = useState<{
    mode: ProjectFormMode;
    project: Project | null;
  } | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Project | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const filteredProjects = useMemo<Project[]>(() => {
    const list = projects ?? [];
    if (!searchQuery.trim()) {
      return sortByName(list);
    }
    const needle = searchQuery.trim().toLowerCase();
    return sortByName(
      list.filter(
        (p) =>
          p.name.toLowerCase().includes(needle) ||
          p.path.toLowerCase().includes(needle)
      )
    );
  }, [projects, searchQuery]);

  const handleDeleteConfirm = async () => {
    if (!deleteTarget) return;
    setDeleteError(null);
    try {
      await deleteMutation.mutateAsync(deleteTarget.id);
      setDeleteTarget(null);
    } catch (err) {
      setDeleteError(formatError(err));
    }
  };

  const closeDeleteDialog = () => {
    setDeleteTarget(null);
    setDeleteError(null);
  };

  return (
    <div className="flex flex-col h-full" data-testid="projects-page">
      <header className="flex items-center justify-between px-6 py-4 border-b border-[var(--color-border)]">
        <div>
          <h1 className="text-xl font-semibold text-[var(--color-text)] flex items-center gap-2">
            <FolderGit2 className="w-5 h-5 text-[var(--color-primary)]" />
            Projects
          </h1>
          <p className="mt-1 text-sm text-[var(--color-text-secondary)]">
            Workspaces registered with Stoneforge on this machine.
          </p>
        </div>
        <button
          type="button"
          onClick={() => setFormDialog({ mode: 'create', project: null })}
          className="
            inline-flex items-center gap-2
            px-3 py-2
            text-sm font-medium
            text-white
            bg-[var(--color-primary)]
            hover:bg-[var(--color-primary-hover)]
            rounded-lg
            transition-colors
          "
          data-testid="projects-page-register-btn"
        >
          <FolderPlus className="w-4 h-4" />
          Register project
        </button>
      </header>

      <div className="flex items-center gap-3 px-6 py-3 border-b border-[var(--color-border)]">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-[var(--color-text-tertiary)]" />
          <input
            type="text"
            placeholder="Filter by name or path…"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="
              w-full pl-8 pr-3 py-1.5
              text-sm
              bg-[var(--color-surface)]
              border border-[var(--color-border)]
              rounded-lg
              placeholder:text-[var(--color-text-tertiary)]
              focus:outline-none focus:ring-2 focus:ring-[var(--color-primary)]/30
            "
            data-testid="projects-page-search"
          />
        </div>
        <div className="text-xs text-[var(--color-text-tertiary)]">
          {projects
            ? `${filteredProjects.length} of ${projects.length}`
            : '—'}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-6 py-4">
        {isLoading ? (
          <div
            className="flex items-center justify-center gap-2 py-12 text-sm text-[var(--color-text-secondary)]"
            data-testid="projects-page-loading"
          >
            <Loader2 className="w-4 h-4 animate-spin" />
            Loading projects…
          </div>
        ) : error ? (
          <ErrorState error={error} onRetry={() => refetch()} />
        ) : filteredProjects.length === 0 ? (
          <EmptyState
            hasProjects={(projects?.length ?? 0) > 0}
            onRegister={() => setFormDialog({ mode: 'create', project: null })}
          />
        ) : (
          <div className="space-y-2">
            {filteredProjects.map((project) => (
              <ProjectRow
                key={project.id}
                project={project}
                onEdit={(p) => setFormDialog({ mode: 'rename', project: p })}
                onDelete={(p) => setDeleteTarget(p)}
              />
            ))}
          </div>
        )}
      </div>

      <ProjectFormDialog
        isOpen={formDialog !== null}
        mode={formDialog?.mode ?? 'create'}
        project={formDialog?.project ?? null}
        onClose={() => setFormDialog(null)}
      />

      <DeleteProjectDialog
        isOpen={deleteTarget !== null}
        projectName={deleteTarget?.name ?? ''}
        projectPath={deleteTarget?.path ?? ''}
        isDeleting={deleteMutation.isPending}
        error={deleteError}
        onClose={closeDeleteDialog}
        onConfirm={handleDeleteConfirm}
      />
    </div>
  );
}

// ============================================================================
// Sub-components
// ============================================================================

function ErrorState({ error, onRetry }: { error: unknown; onRetry: () => void }) {
  const message = formatError(error);
  const code = error instanceof ProjectApiError ? error.code : null;
  const hint =
    code === 'REGISTRY_UNAVAILABLE'
      ? "The server couldn't load ~/.stoneforge/projects.json. Check the server logs for details."
      : null;

  return (
    <div
      className="flex flex-col items-center justify-center gap-3 py-12 text-center"
      data-testid="projects-page-error"
    >
      <AlertCircle className="w-8 h-8 text-[var(--color-danger)]" />
      <div>
        <p className="text-sm font-medium text-[var(--color-text)]">
          Couldn't load projects
        </p>
        <p className="mt-1 text-xs text-[var(--color-text-secondary)] max-w-md">
          {message}
        </p>
        {hint && (
          <p className="mt-1 text-xs text-[var(--color-text-tertiary)] max-w-md">
            {hint}
          </p>
        )}
      </div>
      <button
        type="button"
        onClick={onRetry}
        className="
          px-3 py-1.5
          text-sm font-medium
          text-[var(--color-text)]
          bg-[var(--color-surface)]
          border border-[var(--color-border)]
          rounded-md
          hover:bg-[var(--color-surface-hover)]
        "
      >
        Try again
      </button>
    </div>
  );
}

function EmptyState({
  hasProjects,
  onRegister,
}: {
  hasProjects: boolean;
  onRegister: () => void;
}) {
  if (hasProjects) {
    return (
      <div
        className="flex flex-col items-center justify-center gap-2 py-12 text-center"
        data-testid="projects-page-empty-filter"
      >
        <p className="text-sm text-[var(--color-text-secondary)]">
          No projects match your filter.
        </p>
      </div>
    );
  }

  return (
    <div
      className="flex flex-col items-center justify-center gap-4 py-16 text-center"
      data-testid="projects-page-empty"
    >
      <div className="w-12 h-12 rounded-full bg-[var(--color-primary-muted)] flex items-center justify-center">
        <FolderGit2 className="w-6 h-6 text-[var(--color-primary)]" />
      </div>
      <div>
        <p className="text-sm font-medium text-[var(--color-text)]">
          No registered projects yet
        </p>
        <p className="mt-1 text-xs text-[var(--color-text-secondary)] max-w-md">
          Register a workspace to let Stoneforge associate tasks, agents, and
          sessions with a project root.
        </p>
      </div>
      <button
        type="button"
        onClick={onRegister}
        className="
          inline-flex items-center gap-2
          px-3 py-2
          text-sm font-medium
          text-white
          bg-[var(--color-primary)]
          hover:bg-[var(--color-primary-hover)]
          rounded-lg
        "
        data-testid="projects-page-empty-register-btn"
      >
        <FolderPlus className="w-4 h-4" />
        Register project
      </button>
    </div>
  );
}

// ============================================================================
// Helpers
// ============================================================================

function sortByName(list: Project[]): Project[] {
  return [...list].sort((a, b) => a.name.localeCompare(b.name));
}

function formatError(err: unknown): string {
  if (err instanceof ProjectApiError) return err.message;
  if (err instanceof Error) return err.message;
  return 'Unknown error.';
}
