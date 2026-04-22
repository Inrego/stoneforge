/**
 * ProjectRow — single list entry for a registered project.
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
      data-testid="project-row"
      data-project-id={project.id}
    >
      <FolderGit2 className="w-5 h-5 flex-shrink-0 text-[var(--color-primary)]" />

      <div className="flex-1 min-w-0">
        <div className="flex items-baseline gap-2">
          <span
            className="text-sm font-medium text-[var(--color-text)] truncate"
            data-testid="project-row-name"
          >
            {project.name}
          </span>
          <span className="text-xs text-[var(--color-text-tertiary)] font-mono">
            {project.id}
          </span>
        </div>
        <div
          className="text-xs text-[var(--color-text-secondary)] font-mono truncate"
          title={project.path}
          data-testid="project-row-path"
        >
          {project.path}
        </div>
      </div>

      <div className="flex items-center gap-1 flex-shrink-0">
        <button
          type="button"
          onClick={() => onEdit(project)}
          className="p-1.5 rounded-md text-[var(--color-text-tertiary)] hover:text-[var(--color-text)] hover:bg-[var(--color-surface)] transition-colors"
          aria-label={`Edit ${project.name}`}
          data-testid="project-row-edit"
        >
          <Pencil className="w-4 h-4" />
        </button>
        <button
          type="button"
          onClick={() => onDelete(project)}
          className="p-1.5 rounded-md text-[var(--color-text-tertiary)] hover:text-red-600 dark:hover:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors"
          aria-label={`Remove ${project.name}`}
          data-testid="project-row-delete"
        >
          <Trash2 className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
}
