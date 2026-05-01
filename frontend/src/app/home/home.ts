import {ChangeDetectionStrategy, Component, OnInit, inject, signal} from '@angular/core';
import {Router} from '@angular/router';
import {CommonModule} from '@angular/common';
import {MatButtonModule} from '@angular/material/button';
import {MatIconModule} from '@angular/material/icon';
import {MatListModule} from '@angular/material/list';
import {MatProgressSpinnerModule} from '@angular/material/progress-spinner';
import {MatDialog, MatDialogModule} from '@angular/material/dialog';
import {MatSnackBar, MatSnackBarModule} from '@angular/material/snack-bar';
import {ApiService} from '../service/api.service';
import {ProjectService} from '../service/project.service';
import {Project} from '../models/project.model';
import {Organization} from '../models/organization.model';
import {Scientist} from '../models/scientist.model';
import {ProjectCreateDialogComponent, ProjectCreateDialogResult} from './project-create-dialog/project-create-dialog';
import {
  ProjectEditDialogComponent,
  ProjectEditDialogData,
  ProjectEditDialogResult,
} from './project-edit-dialog/project-edit-dialog';

function parseFilenameFromContentDisposition(header: string | null): string | null {
  if (!header) {
    return null;
  }
  const utf8Match = /filename\*=UTF-8''([^;]+)/i.exec(header);
  if (utf8Match) {
    return decodeURIComponent(utf8Match[1]);
  }
  const quotedMatch = /filename="([^"]+)"/i.exec(header);
  if (quotedMatch) {
    return quotedMatch[1];
  }
  const bareMatch = /filename=([^;]+)/i.exec(header);
  return bareMatch ? bareMatch[1].trim() : null;
}

@Component({
  selector: 'app-home',
  imports: [
    CommonModule,
    MatButtonModule,
    MatIconModule,
    MatListModule,
    MatProgressSpinnerModule,
    MatDialogModule,
    MatSnackBarModule,
  ],
  templateUrl: './home.html',
  styleUrl: './home.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class HomeComponent implements OnInit {
  private readonly api = inject(ApiService);
  private readonly projectService = inject(ProjectService);
  private readonly router = inject(Router);
  private readonly dialog = inject(MatDialog);
  private readonly snackBar = inject(MatSnackBar);

  readonly loading = signal<boolean>(true);
  readonly projects = signal<Project[]>([]);
  private readonly organizations = signal<Organization[]>([]);
  private readonly scientists = signal<Scientist[]>([]);

  ngOnInit(): void {
    this.loadProjects();
    this.api.getOrganizations().subscribe({
      next: (res) => this.organizations.set(res.results),
    });
    this.api.getScientists().subscribe({
      next: (res) => this.scientists.set(res.results),
    });
  }

  selectProject(project: Project): void {
    this.projectService.setCurrent(project);
    this.router.navigateByUrl('/data-entry');
  }

  openCreateDialog(): void {
    const orgs = this.organizations();
    if (orgs.length === 0) {
      this.snackBar.open('Es konnte keine Organisation geladen werden.', 'Schließen', {duration: 3000});
      return;
    }
    const ref = this.dialog.open<ProjectCreateDialogComponent, {organizations: Organization[]}, ProjectCreateDialogResult>(
      ProjectCreateDialogComponent,
      {
        data: {organizations: orgs},
        width: '480px',
      },
    );
    ref.afterClosed().subscribe((result) => {
      if (!result) {
        return;
      }
      this.api.createProject({
        title: result.title,
        description: result.description,
        organization_id: result.organizationHandle,
      }).subscribe({
        next: (project) => {
          this.snackBar.open(`Projekt "${project.title}" wurde erstellt.`, 'Schließen', {duration: 3000});
          this.projects.update((current) => [project, ...current]);
          this.selectProject(project);
        },
        error: () => {
          this.snackBar.open('Projekt konnte nicht erstellt werden.', 'Schließen', {duration: 3000});
        },
      });
    });
  }

  exportIwm(project: Project, event: MouseEvent): void {
    event.stopPropagation();
    this.api.exportIwm(project.id).subscribe({
      next: (response) => {
        const blob = response.body;
        if (!blob) {
          this.snackBar.open('Export ist leer.', 'Schließen', {duration: 3000});
          return;
        }
        const filename =
          parseFilenameFromContentDisposition(response.headers.get('Content-Disposition')) ??
          `IWM_${project.title}.xlsx`;
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = filename;
        document.body.appendChild(link);
        link.click();
        link.remove();
        URL.revokeObjectURL(url);
      },
      error: () => {
        this.snackBar.open('IWM-Export fehlgeschlagen.', 'Schließen', {duration: 3000});
      },
    });
  }

  openEditDialog(project: Project, event: MouseEvent): void {
    event.stopPropagation();
    const ref = this.dialog.open<
      ProjectEditDialogComponent,
      ProjectEditDialogData,
      ProjectEditDialogResult
    >(ProjectEditDialogComponent, {
      data: {project, scientists: this.scientists()},
      width: '480px',
    });
    ref.afterClosed().subscribe((result) => {
      if (!result) {
        return;
      }
      this.api.updateProject(project.id, {
        title: result.title,
        description: result.description,
        scientist_ids: result.scientistIds,
        show_optional_fields: result.showOptionalFields,
      }).subscribe({
        next: (updated) => {
          this.snackBar.open(`Projekt "${updated.title}" wurde aktualisiert.`, 'Schließen', {duration: 3000});
          this.projects.update((current) => current.map((p) => (p.id === updated.id ? updated : p)));
          if (this.projectService.currentProject()?.id === updated.id) {
            this.projectService.setCurrent(updated);
          }
        },
        error: () => {
          this.snackBar.open('Projekt konnte nicht aktualisiert werden.', 'Schließen', {duration: 3000});
        },
      });
    });
  }

  private loadProjects(): void {
    this.loading.set(true);
    this.api.getProjects().subscribe({
      next: (res) => {
        this.projects.set(res.results);
        this.loading.set(false);
      },
      error: () => {
        this.loading.set(false);
        this.snackBar.open('Projekte konnten nicht geladen werden.', 'Schließen', {duration: 3000});
      },
    });
  }
}
