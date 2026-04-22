/**
 * DirectorPicker — popover listing all registered directors, grouped by project.
 *
 * Used in the Director Panel header: clicking the "Directors" button opens the
 * picker, and choosing a row selects that director (opening its interactive
 * session tab). Groups are sorted alphabetically by project id; directors
 * inside a group are sorted by name for stable ordering across renders.
 */

import { useEffect, useMemo, useRef } from 'react';
import { Terminal, ChevronRight, Folder } from 'lucide-react';
import type { DirectorInfo } from '../../api/hooks/useAgents';

/** Directors we can render are expected to expose projectId via metadata. */
function getProjectId(info: DirectorInfo): string {
  const meta = info.director.metadata?.agent;
  if (meta?.agentRole === 'director' && 'projectId' in meta) {
    const value = (meta as { projectId?: unknown }).projectId;
    if (typeof value === 'string' && value.length > 0) {
      return value;
    }
  }
  // Legacy directors created before per-project registration — group under a
  // sentinel so they remain visible and operators can see they need migrating.
  return '(unassigned)';
}

interface DirectorPickerProps {
  readonly directors: DirectorInfo[];
  readonly activeDirectorId: string | null;
  readonly unreadCounts: Record<string, number>;
  readonly onSelect: (directorId: string) => void;
  readonly onClose: () => void;
}

interface ProjectGroup {
  readonly projectId: string;
  readonly directors: DirectorInfo[];
}

/**
 * Groups directors by their `projectId` metadata. Projects with no directors
 * are never created, so the picker is a pure view over the current registry.
 */
function groupDirectorsByProject(directors: DirectorInfo[]): ProjectGroup[] {
  const groups = new Map<string, DirectorInfo[]>();
  for (const info of directors) {
    const projectId = getProjectId(info);
    const bucket = groups.get(projectId);
    if (bucket) {
      bucket.push(info);
    } else {
      groups.set(projectId, [info]);
    }
  }

  return Array.from(groups.entries())
    .map(([projectId, items]) => ({
      projectId,
      directors: [...items].sort((a, b) => a.director.name.localeCompare(b.director.name)),
    }))
    .sort((a, b) => a.projectId.localeCompare(b.projectId));
}

/** Status dot colors mirror the tab bar for visual continuity. */
function statusDotClass(info: DirectorInfo): string {
  if (info.error) return 'bg-[var(--color-danger)]';
  if (info.isLoading) return 'bg-[var(--color-warning)]';
  if (info.hasActiveSession) return 'bg-[var(--color-success)]';
  return 'bg-[var(--color-text-tertiary)]';
}

export function DirectorPicker({
  directors,
  activeDirectorId,
  unreadCounts,
  onSelect,
  onClose,
}: DirectorPickerProps) {
  const containerRef = useRef<HTMLDivElement>(null);

  const groups = useMemo(() => groupDirectorsByProject(directors), [directors]);

  // Dismiss on outside click or Escape so the picker behaves like a menu.
  useEffect(() => {
    const handleMouseDown = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        onClose();
      }
    };
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('mousedown', handleMouseDown);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('mousedown', handleMouseDown);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [onClose]);

  if (directors.length === 0) {
    return (
      <div
        ref={containerRef}
        className="absolute top-full right-0 mt-1 z-50 min-w-[260px]
          bg-[var(--color-bg-elevated)] border border-[var(--color-border)]
          rounded-lg shadow-lg p-3"
        data-testid="director-picker"
      >
        <p className="text-xs text-[var(--color-text-tertiary)]">
          No directors registered yet.
        </p>
      </div>
    );
  }

  return (
    <div
      ref={containerRef}
      className="absolute top-full right-0 mt-1 z-50 min-w-[280px] max-h-[420px] overflow-y-auto
        bg-[var(--color-bg-elevated)] border border-[var(--color-border)]
        rounded-lg shadow-lg py-1"
      role="menu"
      data-testid="director-picker"
    >
      {groups.map(group => (
        <div key={group.projectId} className="py-1">
          <div
            className="flex items-center gap-1.5 px-3 py-1 text-[10px] font-semibold uppercase
              tracking-wider text-[var(--color-text-tertiary)]"
            data-testid={`director-picker-group-${group.projectId}`}
          >
            <Folder className="w-3 h-3" />
            <span className="truncate">{group.projectId}</span>
            <span className="ml-auto text-[10px] font-normal normal-case tracking-normal">
              {group.directors.length}
            </span>
          </div>
          {group.directors.map(info => {
            const isActive = info.director.id === activeDirectorId;
            const unread = unreadCounts[info.director.id] ?? 0;
            return (
              <button
                key={info.director.id}
                type="button"
                role="menuitem"
                onClick={() => {
                  onSelect(info.director.id);
                  onClose();
                }}
                className={`flex w-full items-center gap-2 px-3 py-1.5 text-sm
                  cursor-pointer transition-colors duration-150
                  ${isActive
                    ? 'bg-[var(--color-primary)]/10 text-[var(--color-text)]'
                    : 'text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-hover)] hover:text-[var(--color-text)]'}
                `}
                data-testid={`director-picker-item-${info.director.id}`}
              >
                <Terminal className="w-3.5 h-3.5 flex-shrink-0" />
                <span className={`relative inline-block w-2 h-2 rounded-full ${statusDotClass(info)}`} />
                <span className="flex-1 text-left truncate">{info.director.name}</span>
                {unread > 0 && (
                  <span className="flex items-center justify-center min-w-[16px] h-4 px-1
                    text-[10px] font-bold rounded-full bg-[var(--color-primary)] text-white">
                    {unread > 99 ? '99+' : unread}
                  </span>
                )}
                {isActive && (
                  <ChevronRight className="w-3 h-3 text-[var(--color-primary)]" />
                )}
              </button>
            );
          })}
        </div>
      ))}
    </div>
  );
}
