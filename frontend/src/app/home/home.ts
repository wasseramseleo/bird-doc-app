import {ChangeDetectionStrategy, Component, inject} from '@angular/core';

import {ProjectService} from '../service/project.service';
import {ProjectDashboardComponent} from './project-dashboard/project-dashboard';

/**
 * The logged-in home route `/`. Per ADR 0018 it is the current Projekt's
 * dashboard. Issue #221 moved the project picker out to its own `/projekte`
 * route (ProjectPickerComponent); a functional guard (projectSelectedGuard)
 * redirects `/` there when no Projekt is selected, so Home only ever renders the
 * dashboard for the active Projekt.
 */
@Component({
  selector: 'app-home',
  imports: [ProjectDashboardComponent],
  templateUrl: './home.html',
  styleUrl: './home.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class HomeComponent {
  private readonly projectService = inject(ProjectService);

  readonly currentProject = this.projectService.currentProject;
}
