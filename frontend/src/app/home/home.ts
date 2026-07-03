import {ChangeDetectionStrategy, Component, effect, inject} from '@angular/core';

import {ProjectService} from '../service/project.service';
import {ProjectActionsService} from '../service/project-actions.service';
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
  private readonly actions = inject(ProjectActionsService);

  readonly currentProject = this.projectService.currentProject;

  constructor() {
    // The dashboard's Bearbeiten action opens the shared edit dialog, which needs
    // the Organisationen/Beringer reference data the ProjectActionsService owns
    // (issue #222). The /projekte picker loads it on its way in, but a user who
    // reloads straight onto `/` (a persisted current Projekt) never passes through
    // the picker — so Home loads it here whenever a Projekt is current, keeping the
    // service the single owner of that fetch rather than duplicating it.
    effect(() => {
      if (this.currentProject()) {
        this.actions.loadReferenceData();
      }
    });
  }
}
