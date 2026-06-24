import {ChangeDetectionStrategy, Component, computed, effect, inject} from '@angular/core';
import {Router, RouterLink} from '@angular/router';
import {MatToolbarModule} from '@angular/material/toolbar';
import {MatIconModule} from '@angular/material/icon';
import {MatButtonModule} from '@angular/material/button';
import {MatMenuModule} from '@angular/material/menu';
import {MatDividerModule} from '@angular/material/divider';
import {AuthService} from '../service/auth.service';
import {ProjectService} from '../service/project.service';
import {Project} from '../models/project.model';
import {environment} from '../../environments/environment';

@Component({
  selector: 'app-nav-bar',
  imports: [
    RouterLink,
    MatToolbarModule,
    MatIconModule,
    MatButtonModule,
    MatMenuModule,
    MatDividerModule,
  ],
  templateUrl: './nav-bar.html',
  styleUrl: './nav-bar.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class NavBar {
  private readonly auth = inject(AuthService);
  private readonly projectService = inject(ProjectService);
  private readonly router = inject(Router);

  readonly adminUrl = environment.adminUrl;
  readonly currentProject = this.projectService.currentProject;
  readonly projects = this.projectService.projects;

  private listRequested = false;

  constructor() {
    // The switcher needs the shared project list even when the user reloads
    // straight into the workbench without passing through the picker. Load it
    // once, the first time a project is active.
    effect(() => {
      if (this.currentProject() && !this.listRequested) {
        this.listRequested = true;
        this.projectService.loadProjects().subscribe();
      }
    });
  }

  readonly userLabel = computed(() => {
    const user = this.auth.currentUser();
    if (!user) return '';
    return user.handle ?? user.username;
  });

  readonly isStaff = computed(() => this.auth.currentUser()?.isStaff ?? false);

  switchProject(project: Project): void {
    this.projectService.setCurrent(project);
    this.router.navigateByUrl('/data-entries');
  }

  goToPicker(): void {
    this.router.navigateByUrl('/');
  }

  onLogout(): void {
    this.auth.logout().subscribe({
      next: () => this.router.navigate(['/login']),
      error: () => this.router.navigate(['/login']),
    });
  }
}
