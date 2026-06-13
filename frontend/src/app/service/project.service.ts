import {Injectable, inject, signal} from '@angular/core';
import {Project} from '../models/project.model';
import {WorkbenchStorageService} from './workbench-storage.service';

@Injectable({providedIn: 'root'})
export class ProjectService {
  private readonly storage = inject(WorkbenchStorageService);

  // Rehydrated from storage so a browser reload returns to the entry form
  // rather than project selection.
  readonly currentProject = signal<Project | null>(this.storage.loadCurrentProject());

  setCurrent(project: Project): void {
    this.currentProject.set(project);
    this.storage.saveCurrentProject(project);
  }

  clear(): void {
    this.currentProject.set(null);
    this.storage.saveCurrentProject(null);
  }
}
