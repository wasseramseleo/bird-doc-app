import {Injectable, signal} from '@angular/core';
import {Project} from '../models/project.model';

@Injectable({providedIn: 'root'})
export class ProjectService {
  readonly currentProject = signal<Project | null>(null);

  setCurrent(project: Project): void {
    this.currentProject.set(project);
  }

  clear(): void {
    this.currentProject.set(null);
  }
}
