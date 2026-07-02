import {Injectable, inject, signal} from '@angular/core';
import {Observable} from 'rxjs';
import {map, tap} from 'rxjs/operators';
import {Project} from '../models/project.model';
import {WorkbenchStorageService} from './workbench-storage.service';
import {DataAccessFacadeService} from './data-access-facade.service';

@Injectable({providedIn: 'root'})
export class ProjectService {
  private readonly storage = inject(WorkbenchStorageService);
  // Offline-aware (issue #159, PRD #152): the Projekt switcher/picker falls
  // back to the cached Projekte when the server is unreachable.
  private readonly api = inject(DataAccessFacadeService);

  // Rehydrated from storage so a browser reload returns to the entry form
  // rather than project selection.
  readonly currentProject = signal<Project | null>(this.storage.loadCurrentProject());

  // Shared source of truth for the user's projects, consumed by both the Home
  // picker and the navbar switcher so they can never disagree.
  private readonly projectList = signal<Project[]>([]);
  readonly projects = this.projectList.asReadonly();

  loadProjects(): Observable<Project[]> {
    return this.api.getProjects().pipe(
      map((res) => res.results),
      tap((projects) => this.projectList.set(projects)),
    );
  }

  // Keep the shared list consistent after a create (prepend) or edit (replace
  // in place), without re-fetching.
  upsertProject(project: Project): void {
    this.projectList.update((current) =>
      current.some((p) => p.id === project.id)
        ? current.map((p) => (p.id === project.id ? project : p))
        : [project, ...current],
    );
  }

  setCurrent(project: Project): void {
    this.currentProject.set(project);
    this.storage.saveCurrentProject(project);
  }

  clear(): void {
    this.currentProject.set(null);
    this.storage.saveCurrentProject(null);
  }
}
