import {Injectable} from '@angular/core';
import {Project} from '../models/project.model';
import {Scientist} from '../models/scientist.model';

/**
 * Persists the data-enterer's working context across reloads:
 * the currently selected Projekt and the last-used Beringer per Projekt.
 *
 * This is the single boundary over `localStorage`; all (de)serialisation,
 * key naming and defensive handling of missing/corrupt/unavailable storage
 * lives here so callers deal in plain domain objects.
 */
@Injectable({providedIn: 'root'})
export class WorkbenchStorageService {
  private static readonly CURRENT_PROJECT_KEY = 'birddoc.currentProject';
  private static readonly LAST_BERINGER_KEY = 'birddoc.lastBeringerByProject';

  loadCurrentProject(): Project | null {
    return this.read<Project>(WorkbenchStorageService.CURRENT_PROJECT_KEY);
  }

  saveCurrentProject(project: Project | null): void {
    if (project === null) {
      this.remove(WorkbenchStorageService.CURRENT_PROJECT_KEY);
      return;
    }
    this.write(WorkbenchStorageService.CURRENT_PROJECT_KEY, project);
  }

  loadLastBeringer(projectId: string): Scientist | null {
    const byProject = this.read<Record<string, Scientist>>(
      WorkbenchStorageService.LAST_BERINGER_KEY,
    );
    return byProject?.[projectId] ?? null;
  }

  saveLastBeringer(projectId: string, beringer: Scientist): void {
    const byProject =
      this.read<Record<string, Scientist>>(WorkbenchStorageService.LAST_BERINGER_KEY) ?? {};
    byProject[projectId] = beringer;
    this.write(WorkbenchStorageService.LAST_BERINGER_KEY, byProject);
  }

  private read<T>(key: string): T | null {
    try {
      const raw = localStorage.getItem(key);
      return raw ? (JSON.parse(raw) as T) : null;
    } catch {
      // Corrupt JSON or storage unavailable — behave as if nothing was stored.
      return null;
    }
  }

  private write(key: string, value: unknown): void {
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch {
      // Storage unavailable (private mode, quota exceeded) — degrade silently.
    }
  }

  private remove(key: string): void {
    try {
      localStorage.removeItem(key);
    } catch {
      // Storage unavailable — nothing to clear.
    }
  }
}
