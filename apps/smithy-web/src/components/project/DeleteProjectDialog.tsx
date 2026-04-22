/**
 * DeleteProjectDialog — Confirmation dialog for removing a project from
 * the registry. Parallel to DeleteAgentDialog.
 *
 * Note: "delete" here only unregisters the project from
 * `~/.stoneforge/projects.json` — the filesystem directory and its git
 * repository are not touched.
 */

import { useEffect } from 'react';
import { AlertTriangle, Loader2, Trash2 } from 'lucide-react';

export interface DeleteProjectDialogProps {
  isOpen: boolean;
  onClose: () => void;
  projectName: string;
  projectPath: string;
  onConfirm: () => void;
  isDeleting: boolean;
  error?: string | null;
}

export function DeleteProjectDialog({
  isOpen,
  onClose,
  projectName,
  projectPath,
  onConfirm,
  isDeleting,
  error,
}: DeleteProjectDialogProps) {
  useEffect(() => {
    if (!isOpen) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !isDeleting) onClose();
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [isOpen, isDeleting, onClose]);

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center"
      data-testid="delete-project-dialog"
    >
      <div
        className="absolute inset-0 bg-black/50"
        onClick={() => !isDeleting && onClose()}
      />
      <div className="relative bg-[var(--color-surface)] rounded-lg shadow-xl max-w-md w-full mx-4 p-6">
        <div className="flex items-start gap-4">
          <div className="flex-shrink-0 w-10 h-10 rounded-full bg-[var(--color-danger-muted)] flex items-center justify-center">
            <Trash2 className="w-5 h-5 text-[var(--color-danger)]" />
          </div>
          <div className="flex-1 min-w-0">
            <h3 className="text-lg font-semibold text-[var(--color-text)]">
              Unregister project
            </h3>
            <p className="mt-2 text-sm text-[var(--color-text-secondary)]">
              Remove{' '}
              <span className="font-medium text-[var(--color-text)]">
                "{projectName}"
              </span>{' '}
              from the projects registry?
            </p>
            <p
              className="mt-1 text-xs font-mono text-[var(--color-text-tertiary)] break-all"
              title={projectPath}
            >
              {projectPath}
            </p>
            <div
              className="mt-3 flex items-start gap-2 text-xs text-[var(--color-text-secondary)] bg-[var(--color-surface-hover)] border border-[var(--color-border)] rounded-md px-3 py-2"
            >
              <AlertTriangle className="w-4 h-4 flex-shrink-0 mt-0.5 text-[var(--color-warning)]" />
              <span>
                Only the registry entry is removed. Files on disk, tasks,
                and agents already associated with this project are left
                untouched.
              </span>
            </div>
            {error && (
              <p className="mt-3 text-sm text-[var(--color-danger)]" data-testid="delete-project-error">
                {error}
              </p>
            )}
          </div>
        </div>
        <div className="mt-6 flex justify-end gap-3">
          <button
            type="button"
            onClick={onClose}
            disabled={isDeleting}
            className="px-4 py-2 text-sm font-medium text-[var(--color-text-secondary)] bg-[var(--color-surface)] border border-[var(--color-border)] rounded-md hover:bg-[var(--color-surface-hover)] disabled:opacity-50"
            data-testid="delete-project-cancel-btn"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={isDeleting}
            className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium text-white bg-[var(--color-danger)] rounded-md hover:opacity-90 disabled:opacity-50"
            data-testid="delete-project-confirm-btn"
          >
            {isDeleting ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                Unregistering…
              </>
            ) : (
              <>
                <Trash2 className="w-4 h-4" />
                Unregister
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
