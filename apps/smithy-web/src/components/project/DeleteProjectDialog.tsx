/**
 * DeleteProjectDialog — confirmation dialog for removing a project.
 *
 * Registry deletion only unregisters the project from the dashboard; the
 * underlying workspace files on disk are untouched. The dialog makes that
 * explicit so users don't fear data loss.
 */

import { useState } from 'react';
import { AlertTriangle, Loader2, Trash2, X } from 'lucide-react';
import type { Project } from '../../api/hooks/useProjects';
import { useDeleteProject } from '../../api/hooks/useProjects';

export interface DeleteProjectDialogProps {
  isOpen: boolean;
  project: Project | null;
  onClose: () => void;
  onDeleted?: (id: string) => void;
}

export function DeleteProjectDialog({
  isOpen,
  project,
  onClose,
  onDeleted,
}: DeleteProjectDialogProps) {
  const deleteMutation = useDeleteProject();
  const [error, setError] = useState<string | null>(null);

  if (!isOpen || !project) return null;

  const handleClose = () => {
    if (deleteMutation.isPending) return;
    setError(null);
    onClose();
  };

  const handleConfirm = async () => {
    setError(null);
    try {
      await deleteMutation.mutateAsync(project.id);
      onDeleted?.(project.id);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete project');
    }
  };

  return (
    <>
      <div
        className="fixed inset-0 z-40 bg-black/50 animate-fade-in"
        onClick={handleClose}
        data-testid="delete-project-backdrop"
      />

      <div className="fixed inset-0 z-50 flex items-center justify-center p-4 pointer-events-none">
        <div
          className="
            w-full max-w-md
            flex flex-col
            bg-[var(--color-bg)]
            rounded-xl shadow-2xl
            border border-[var(--color-border)]
            animate-scale-in
            pointer-events-auto
          "
          data-testid="delete-project-dialog"
          role="alertdialog"
          aria-labelledby="delete-project-title"
        >
          <div className="flex items-center justify-between px-4 py-3 border-b border-[var(--color-border)] flex-shrink-0">
            <div className="flex items-center gap-2">
              <AlertTriangle className="w-5 h-5 text-red-500" />
              <h2
                id="delete-project-title"
                className="text-lg font-semibold text-[var(--color-text)]"
              >
                Remove project?
              </h2>
            </div>
            <button
              type="button"
              onClick={handleClose}
              className="p-1.5 rounded-lg text-[var(--color-text-tertiary)] hover:text-[var(--color-text)] hover:bg-[var(--color-surface-hover)] transition-colors"
              aria-label="Close dialog"
              data-testid="delete-project-close"
            >
              <X className="w-5 h-5" />
            </button>
          </div>

          <div className="p-4 space-y-3">
            <p className="text-sm text-[var(--color-text)]">
              Unregister <strong>{project.name}</strong> from Stoneforge?
            </p>
            <p className="text-xs text-[var(--color-text-tertiary)] font-mono break-all">
              {project.path}
            </p>
            <p className="text-xs text-[var(--color-text-tertiary)]">
              This only removes the project from the dashboard registry. Files on disk
              are untouched.
            </p>

            {error && (
              <div
                role="alert"
                className="flex items-center gap-2 px-3 py-2 text-sm text-red-700 dark:text-red-300 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg"
              >
                <AlertTriangle className="w-4 h-4 flex-shrink-0" />
                <span className="break-words">{error}</span>
              </div>
            )}
          </div>

          <div className="flex justify-end gap-2 px-4 py-3 border-t border-[var(--color-border)] flex-shrink-0">
            <button
              type="button"
              onClick={handleClose}
              disabled={deleteMutation.isPending}
              className="px-4 py-2 text-sm font-medium text-[var(--color-text-secondary)] hover:text-[var(--color-text)] hover:bg-[var(--color-surface-hover)] disabled:opacity-50 rounded-lg transition-colors"
              data-testid="delete-project-cancel"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handleConfirm}
              disabled={deleteMutation.isPending}
              className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-white bg-red-600 hover:bg-red-700 disabled:opacity-50 disabled:cursor-not-allowed rounded-lg transition-colors"
              data-testid="delete-project-confirm"
            >
              {deleteMutation.isPending ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <Trash2 className="w-4 h-4" />
              )}
              Remove
            </button>
          </div>
        </div>
      </div>
    </>
  );
}
