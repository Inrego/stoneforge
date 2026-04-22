/**
 * ProjectFormDialog — Create or rename a registered project.
 *
 * A single dialog handles both flows because the markup is nearly
 * identical and collapsing them keeps the import/export surface small:
 *
 *   mode="create" — both name and path are required; path is validated
 *                   server-side against `.git`.
 *   mode="rename" — only the name field is editable; the path is shown
 *                   read-only for context because renaming a project
 *                   doesn't move its files.
 */

import { useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import { AlertCircle, FolderPlus, Loader2, Pencil, X } from 'lucide-react';
import {
  ProjectApiError,
  useCreateProject,
  useUpdateProject,
  type Project,
} from '../../api/hooks/useProjects';

export type ProjectFormMode = 'create' | 'rename';

export interface ProjectFormDialogProps {
  isOpen: boolean;
  onClose: () => void;
  mode: ProjectFormMode;
  /** The existing project for rename; ignored in create mode. */
  project?: Project | null;
  onSuccess?: (project: Project) => void;
}

// ============================================================================
// Component
// ============================================================================

export function ProjectFormDialog({
  isOpen,
  onClose,
  mode,
  project,
  onSuccess,
}: ProjectFormDialogProps) {
  const [name, setName] = useState('');
  const [path, setPath] = useState('');
  const [error, setError] = useState<string | null>(null);

  const createProject = useCreateProject();
  const updateProject = useUpdateProject();
  const isPending = createProject.isPending || updateProject.isPending;

  // Reset form state every time the dialog opens. `project` may change
  // underneath us when the user switches from one rename to another
  // without closing the dialog, so we key off both `isOpen` and
  // `project?.id`.
  useEffect(() => {
    if (!isOpen) return;
    setError(null);
    if (mode === 'rename' && project) {
      setName(project.name);
      setPath(project.path);
    } else {
      setName('');
      setPath('');
    }
  }, [isOpen, mode, project?.id, project?.name, project?.path]);

  // Esc closes the dialog (unless a mutation is in flight).
  useEffect(() => {
    if (!isOpen) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !isPending) onClose();
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [isOpen, isPending, onClose]);

  if (!isOpen) return null;

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);

    const trimmedName = name.trim();
    if (trimmedName.length === 0) {
      setError('Project name is required.');
      return;
    }

    try {
      if (mode === 'create') {
        const trimmedPath = path.trim();
        if (trimmedPath.length === 0) {
          setError('Project path is required.');
          return;
        }
        const created = await createProject.mutateAsync({
          name: trimmedName,
          path: trimmedPath,
        });
        onSuccess?.(created);
      } else {
        if (!project) {
          setError('No project selected to rename.');
          return;
        }
        if (trimmedName === project.name) {
          // No-op rename; just close without hitting the server.
          onClose();
          return;
        }
        const updated = await updateProject.mutateAsync({
          id: project.id,
          name: trimmedName,
        });
        onSuccess?.(updated);
      }
      onClose();
    } catch (err) {
      setError(formatError(err));
    }
  };

  const Icon = mode === 'create' ? FolderPlus : Pencil;
  const title = mode === 'create' ? 'Register Project' : 'Rename Project';
  const submitLabel = mode === 'create' ? 'Register' : 'Save';
  const submitPendingLabel = mode === 'create' ? 'Registering…' : 'Saving…';

  return (
    <>
      <div
        className="fixed inset-0 z-40 bg-black/50 animate-fade-in"
        onClick={() => !isPending && onClose()}
        data-testid="project-form-backdrop"
      />
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4 pointer-events-none">
        <div
          className="
            w-full max-w-lg
            bg-[var(--color-bg)]
            rounded-xl shadow-2xl
            border border-[var(--color-border)]
            animate-scale-in
            pointer-events-auto
          "
          data-testid="project-form-dialog"
          role="dialog"
          aria-labelledby="project-form-title"
        >
          <div className="flex items-center justify-between px-4 py-3 border-b border-[var(--color-border)]">
            <div className="flex items-center gap-2">
              <Icon className="w-5 h-5 text-[var(--color-primary)]" />
              <h2
                id="project-form-title"
                className="text-lg font-semibold text-[var(--color-text)]"
              >
                {title}
              </h2>
            </div>
            <button
              type="button"
              onClick={() => !isPending && onClose()}
              className="
                p-1.5 rounded-lg
                text-[var(--color-text-tertiary)]
                hover:text-[var(--color-text)]
                hover:bg-[var(--color-surface-hover)]
                transition-colors
              "
              aria-label="Close dialog"
              data-testid="project-form-close"
            >
              <X className="w-5 h-5" />
            </button>
          </div>

          <form onSubmit={handleSubmit} className="p-4 space-y-4">
            {error && (
              <div
                className="flex items-start gap-2 px-3 py-2 text-sm text-red-700 dark:text-red-300 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg"
                data-testid="project-form-error"
              >
                <AlertCircle className="w-4 h-4 mt-0.5 flex-shrink-0" />
                <span>{error}</span>
              </div>
            )}

            <div className="space-y-1">
              <label
                htmlFor="project-name"
                className="text-sm font-medium text-[var(--color-text)]"
              >
                Project name
              </label>
              <input
                id="project-name"
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g., stoneforge"
                className="
                  w-full px-3 py-2
                  text-sm
                  bg-[var(--color-surface)]
                  border border-[var(--color-border)]
                  rounded-lg
                  placeholder:text-[var(--color-text-tertiary)]
                  focus:outline-none focus:ring-2 focus:ring-[var(--color-primary)]/30
                "
                autoFocus
                maxLength={100}
                data-testid="project-name-input"
              />
              <p className="text-xs text-[var(--color-text-tertiary)]">
                Human-readable display name. Must be unique across registered projects.
              </p>
            </div>

            <div className="space-y-1">
              <label
                htmlFor="project-path"
                className="text-sm font-medium text-[var(--color-text)]"
              >
                Filesystem path
              </label>
              <input
                id="project-path"
                type="text"
                value={path}
                onChange={(e) => mode === 'create' && setPath(e.target.value)}
                readOnly={mode === 'rename'}
                placeholder="/absolute/path/to/your/workspace"
                className={`
                  w-full px-3 py-2
                  text-sm font-mono
                  bg-[var(--color-surface)]
                  border border-[var(--color-border)]
                  rounded-lg
                  placeholder:text-[var(--color-text-tertiary)]
                  focus:outline-none focus:ring-2 focus:ring-[var(--color-primary)]/30
                  ${mode === 'rename' ? 'opacity-60 cursor-not-allowed' : ''}
                `}
                data-testid="project-path-input"
              />
              <p className="text-xs text-[var(--color-text-tertiary)]">
                {mode === 'create'
                  ? 'Absolute path to the project root. Must be an existing git repository.'
                  : 'Path is fixed once registered. Unregister and re-register to relocate.'}
              </p>
            </div>

            <div className="flex justify-end gap-2 pt-2 border-t border-[var(--color-border)]">
              <button
                type="button"
                onClick={() => !isPending && onClose()}
                disabled={isPending}
                className="
                  px-4 py-2
                  text-sm font-medium
                  text-[var(--color-text-secondary)]
                  hover:text-[var(--color-text)]
                  hover:bg-[var(--color-surface-hover)]
                  rounded-lg
                  transition-colors
                  disabled:opacity-50
                "
                data-testid="project-form-cancel"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={
                  isPending ||
                  name.trim().length === 0 ||
                  (mode === 'create' && path.trim().length === 0)
                }
                className="
                  inline-flex items-center gap-2
                  px-4 py-2
                  text-sm font-medium
                  text-white
                  bg-[var(--color-primary)]
                  hover:bg-[var(--color-primary-hover)]
                  disabled:opacity-50 disabled:cursor-not-allowed
                  rounded-lg
                  transition-colors
                "
                data-testid="project-form-submit"
              >
                {isPending ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    {submitPendingLabel}
                  </>
                ) : (
                  <>
                    <Icon className="w-4 h-4" />
                    {submitLabel}
                  </>
                )}
              </button>
            </div>
          </form>
        </div>
      </div>
    </>
  );
}

// ============================================================================
// Helpers
// ============================================================================

/**
 * Render a user-friendly message for an API error. The server sends
 * stable `code` values alongside the message; we map a few common ones
 * to nicer copy and fall back to the raw message otherwise.
 */
function formatError(err: unknown): string {
  if (err instanceof ProjectApiError) {
    switch (err.code) {
      case 'INVALID_PATH':
        return `That path isn't a git repository: ${err.message}`;
      case 'CONFLICT':
        return err.message;
      case 'REGISTRY_UNAVAILABLE':
        return 'Projects registry is currently unavailable. Check the server logs.';
      default:
        return err.message;
    }
  }
  return err instanceof Error ? err.message : 'Unknown error.';
}
