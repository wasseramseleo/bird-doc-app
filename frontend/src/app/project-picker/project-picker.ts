import {ChangeDetectionStrategy, Component, OnInit, inject, signal} from '@angular/core';
import {Router} from '@angular/router';

import {MatButtonModule} from '@angular/material/button';
import {MatIconModule} from '@angular/material/icon';
import {MatProgressSpinnerModule} from '@angular/material/progress-spinner';
import {MatSnackBar, MatSnackBarModule} from '@angular/material/snack-bar';

import {ProjectService} from '../service/project.service';
import {ProjectActionsService} from '../service/project-actions.service';
import {Project} from '../models/project.model';

/**
 * The pre-Visualisierung project picker, now at its own `/projekte` route
 * (issue #221). Lists every Projekt visible to the user and offers, per row,
 * open/select plus "Bearbeiten" and IWM-Export, and a page-level "Neues Projekt"
 * create action. Create/edit/export are delegated to {@link ProjectActionsService}
 * (the single source of truth); selecting a Projekt makes it current and lands on
 * its dashboard at `/` (ADR 0018).
 */
@Component({
  selector: 'app-project-picker',
  imports: [MatButtonModule, MatIconModule, MatProgressSpinnerModule, MatSnackBarModule],
  templateUrl: './project-picker.html',
  styleUrl: './project-picker.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ProjectPickerComponent implements OnInit {
  private readonly projectService = inject(ProjectService);
  private readonly actions = inject(ProjectActionsService);
  private readonly router = inject(Router);
  private readonly snackBar = inject(MatSnackBar);

  readonly loading = signal<boolean>(true);
  // Rendered from the shared ProjectService list so the picker and the navbar
  // switcher can never disagree about which Projekte exist.
  readonly projects = this.projectService.projects;

  ngOnInit(): void {
    // The create/edit dialogs need the Organisationen and Beringer; the shared
    // ProjectActionsService owns loading them.
    this.actions.loadReferenceData();
    this.loading.set(true);
    this.projectService.loadProjects().subscribe({
      next: () => this.loading.set(false),
      error: () => {
        this.loading.set(false);
        this.snackBar.open('Projekte konnten nicht geladen werden.', 'Schließen', {duration: 3000});
      },
    });
  }

  selectProject(project: Project): void {
    this.projectService.setCurrent(project);
    // ADR 0018: selecting a Projekt lands on its dashboard (`/`), not the picker.
    this.router.navigateByUrl('/');
  }

  create(): void {
    this.actions.create();
  }

  edit(project: Project, event: MouseEvent): void {
    // Keep the per-row action from also selecting the Projekt.
    event.stopPropagation();
    this.actions.edit(project);
  }

  exportIwm(project: Project, event: MouseEvent): void {
    event.stopPropagation();
    this.actions.exportIwm(project);
  }
}
