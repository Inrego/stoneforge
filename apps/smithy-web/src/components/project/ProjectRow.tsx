/**
 * ProjectRow — single-line card rendering a registered project.
 *
 * Shows the display name, filesystem path, and a short registration
 * timestamp, with inline rename/delete actions that surface the owning
 * page's dialogs.
 */

import { FolderGit2, Pencil, Trash2 } from 'lucide-react';
import type { Project } from '../../api/hooks/useProjects';

export interface ProjectRowProps {
  project: Project;
  onEdit: (project: Project) => void;
  onDelete: (project: Project) => void;
}

export function ProjectRow({ project, onEdit, onDelete }: ProjectRowProps) {
  return (
    <div
      className="
        flex items-center gap-3 px-4 py-3
        bg-[var(--color-surface)]
        border border-[var(--color-border)]
        rounded-lg
        hover:bg-[var(--color-surface-hover)]
        transition-colors
      "
      data-testid={`project-row-${project.id}`}
    >
      <div className="flex-shrink-0 w-9 h-9 rounded-md bg-[var(--color-primary-muted)] flex items-center justify-center">
        <FolderGit2 className="w-4 h-4 text-[var(--color-primary)]" />
      </div>

      <div className="flex-1 min-w-0">
        <div className="flex items-baseline gap-2">
          <span
            className="text-sm font-medium text-[var(--color-text)] truncate"
            data-testid="project-row-name"
          >
            {project.name}
          </span>
          <span
            className="text-[11px] text-[var(--color-text-tertiary)] flex-shrink-0"
            title={project.registeredAt}
          >
            registered {formatRelativeTime(project.registeredAt)}
          </span>
        </div>
        <div
          className="text-xs font-mono text-[var(--color-text-tertiary)] truncate"
          data-testid="project-row-path"
          title={project.path}
        >
          {project.path}
        </div>
      </div>

      <div className="flex items-center gap-1 flex-shrink-0">
        <button
          type="button"
          onClick={() => onEdit(project)}
          className="
            p-1.5 rounded-md
            text-[var(--color-text-tertiary)]
            hover:text-[var(--color-text)]
            hover:bg-[var(--color-surface-hover)]
            transition-colors
          "
          aria-label={`Rename ${project.name}`}
          data-testid={`project-row-edit-${project.id}`}
        >
          <Pencil className="w-4 h-4" />
        </button>
        <button
          type="button"
          onClick={() => onDelete(project)}
          className="
            p-1.5 rounded-md
            text-[var(--color-text-tertiary)]
            hover:text-[var(--color-danger)]
            hover:bg-[var(--color-danger-muted)]
            transition-colors
          "
          aria-label={`Unregister ${project.name}`}
          data-testid={`project-row-delete-${project.id}`}
        >
          <Trash2 className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
}

// ============================================================================
// Helpers
// ============================================================================

const RELATIVE_FORMATTER =
  typeof Intl !== 'undefined' && 'RelativeTimeFormat' in Intl
    ? new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' })
    : null;

const UNITS: Array<{ unit: Intl.RelativeTimeFormatUnit; seconds: number }> = [
  { unit: 'year', seconds: 60 * 60 * 24 * 365 },
  { unit: 'month', seconds: 60 * 60 * 24 * 30 },
  { unit: 'week', seconds: 60 * 60 * 24 * 7 },
  { unit: 'day', seconds: 60 * 60 * 24 },
  { unit: 'hour', seconds: 60 * 60 },
  { unit: 'minute', seconds: 60 },
];

/**
 * Compact "registered 5 minutes ago" rendering. Falls back to the raw
 * ISO string in environments without Intl.RelativeTimeFormat (very old
 * browsers / SSR contexts).
 */
function formatRelativeTime(iso: string): string {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return iso;
  const diffSeconds = Math.round((then - Date.now()) / 1000);
  if (!RELATIVE_FORMATTER) {
    return iso;
  }
  for (const { unit, seconds } of UNITS) {
    if (Math.abs(diffSeconds) >= seconds) {
      return RELATIVE_FORMATTER.format(Math.round(diffSeconds / seconds), unit);
    }
  }
  return RELATIVE_FORMATTER.format(diffSeconds, 'second');
}
