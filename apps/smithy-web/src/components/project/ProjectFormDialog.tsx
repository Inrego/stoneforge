/**
 * ProjectFormDialog — create / edit dialog for registry entries.
 *
 * Shared by the Projects page for both "add new project" and "rename/relocate"
 * flows. Empty `project` prop == create mode.
 *
 * Follows the dialog pattern used by pool/agent dialogs: fixed backdrop +
 * centered card, scrollable body, sticky footer, server-side validation
 * surfaced through a red banner.
 */

import { useEffect, useState } from 'react';
import { AlertCircle, FolderGit2, Loader2, X } from 'lucide-react';
import type { Project } from '../../api/hooks/useProjects';
import {
  useCreateProject,
  useUpdateProject,
  type UpdateProjectInput,
} from '../../api/hooks/useProjects';

export interface ProjectFormDialogProps {
  isOpen: boolean;
  /** When provided the dialog is in edit mode; omit to create a new project. */
  project?: Project;
  onClose: () => void;
  onSuccess?: (project: Project) => void;
}

interface FormState {
  name: string;
  path: string;
}

function initialState(project?: Project): FormState {
  return {
    name: project?.name ?? '',
    path: project?.path ?? '',
  };
}

export function ProjectFormDialog({
  isOpen,
  project,
  onClose,
  onSuccess,
}: ProjectFormDialogProps) {
  const isEdit = !!project;
  const [form, setForm] = useState<FormState>(() => initialState(project));
  const [error, setError] = useState<string | null>(null);

  const createMutation = useCreateProject();
  const updateMutation = useUpdateProject();
  const pending = createMutation.isPending || updateMutation.isPending;

  // Reset form state whenever the dialog opens or the target project changes.
  useEffect(() => {
    if (isOpen) {
      setForm(initialState(project));
      setError(null);
    }
  }, [isOpen, project]);

  if (!isOpen) return null;

  const handleClose = () => {
    if (pending) return;
    setError(null);
    onClose();
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    const name = form.name.trim();
    const path = form.path.trim();

    if (!name) {
      setError('Name is required');
      return;
    }
    if (!path) {
      setError('Filesystem path is required');
      return;
    }

    try {
      if (isEdit && project) {
        const input: UpdateProjectInput = {};
        if (name !== project.name) input.name = name;
        if (path !== project.path) input.path = path;

        if (!input.name && !input.path) {
          // Nothing to update — treat as success so the caller can close.
          onSuccess?.(project);
          onClose();
          return;
        }

        const updated = await updateMutation.mutateAsync({ id: project.id, ...input });
        onSuccess?.(updated);
      } else {
        const created = await createMutation.mutateAsync({ name, path });
        onSuccess?.(created);
      }
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong');
    }
  };

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 z-40 bg-black/50 animate-fade-in"
        onClick={handleClose}
        data-testid="project-dialog-backdrop"
      />

      {/* Dialog */}
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4 pointer-events-none">
        <div
          className="
            w-full max-w-lg max-h-[90vh]
            flex flex-col
            bg-[var(--color-bg)]
            rounded-xl shadow-2xl
            border border-[var(--color-border)]
            animate-scale-in
            pointer-events-auto
          "
          data-testid="project-dialog"
          role="dialog"
          aria-labelledby="project-dialog-title"
        >
          <div className="flex items-center justify-between px-4 py-3 border-b border-[var(--color-border)] flex-shrink-0">
            <div className="flex items-center gap-2">
              <FolderGit2 className="w-5 h-5 text-[var(--color-primary)]" />
              <h2
                id="project-dialog-title"
                className="text-lg font-semibold text-[var(--color-text)]"
              >
                {isEdit ? 'Edit Project' : 'Register Project'}
              </h2>
            </div>
            <button
              type="button"
              onClick={handleClose}
              className="p-1.5 rounded-lg text-[var(--color-text-tertiary)] hover:text-[var(--color-text)] hover:bg-[var(--color-surface-hover)] transition-colors"
              aria-label="Close dialog"
              data-testid="project-dialog-close"
            >
              <X className="w-5 h-5" />
            </button>
          </div>

          <form onSubmit={handleSubmit} className="flex flex-col min-h-0 flex-1">
            <div className="overflow-y-auto flex-1 min-h-0 p-4 space-y-4">
              {error && (
                <div
                  role="alert"
                  className="flex items-start gap-2 px-3 py-2 text-sm text-red-700 dark:text-red-300 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg"
                  data-testid="project-dialog-error"
                >
                  <AlertCircle className="w-4 h-4 flex-shrink-0 mt-0.5" />
                  <span className="break-words">{error}</span>
                </div>
              )}

              <div className="space-y-1">
                <label
                  htmlFor="project-name"
                  className="text-sm font-medium text-[var(--color-text)]"
                >
                  Name
                </label>
                <input
                  id="project-name"
                  type="text"
                  value={form.name}
                  onChange={(e) => setForm((prev) => ({ ...prev, name: e.target.value }))}
                  placeholder="my-workspace"
                  maxLength={100}
                  className="w-full px-3 py-2 text-sm bg-[var(--color-surface)] border border-[var(--color-border)] rounded-lg placeholder:text-[var(--color-text-tertiary)] focus:outline-none focus:ring-2 focus:ring-[var(--color-primary)]/30"
                  autoFocus
                  data-testid="project-name-input"
                  required
                />
                <p className="text-xs text-[var(--color-text-tertiary)]">
                  Must be unique across registered projects.
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
                  value={form.path}
                  onChange={(e) => setForm((prev) => ({ ...prev, path: e.target.value }))}
                  placeholder="/abs/path/to/workspace"
                  className="w-full px-3 py-2 text-sm font-mono bg-[var(--color-surface)] border border-[var(--color-border)] rounded-lg placeholder:text-[var(--color-text-tertiary)] focus:outline-none focus:ring-2 focus:ring-[var(--color-primary)]/30"
                  data-testid="project-path-input"
                  required
                />
                <p className="text-xs text-[var(--color-text-tertiary)]">
                  Absolute path to an existing git repository on this machine.
                </p>
              </div>
            </div>

            <div className="flex justify-end gap-2 px-4 py-3 border-t border-[var(--color-border)] flex-shrink-0">
              <button
                type="button"
                onClick={handleClose}
                disabled={pending}
                className="px-4 py-2 text-sm font-medium text-[var(--color-text-secondary)] hover:text-[var(--color-text)] hover:bg-[var(--color-surface-hover)] disabled:opacity-50 rounded-lg transition-colors"
                data-testid="project-dialog-cancel"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={pending || !form.name.trim() || !form.path.trim()}
                className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-white bg-[var(--color-primary)] hover:bg-[var(--color-primary-hover)] disabled:opacity-50 disabled:cursor-not-allowed rounded-lg transition-colors"
                data-testid="project-dialog-submit"
              >
                {pending && <Loader2 className="w-4 h-4 animate-spin" />}
                {isEdit ? 'Save changes' : 'Register project'}
              </button>
            </div>
          </form>
        </div>
      </div>
    </>
  );
}
