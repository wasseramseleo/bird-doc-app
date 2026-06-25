import {ChangeDetectionStrategy, Component, computed, effect, inject} from '@angular/core';
import {toSignal} from '@angular/core/rxjs-interop';
import {NavigationEnd, Router, RouterLink, RouterLinkActive} from '@angular/router';
import {filter, map} from 'rxjs';
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
    RouterLinkActive,
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

  // The active route path (without query/fragment), kept fresh on navigation.
  private readonly currentPath = toSignal(
    this.router.events.pipe(
      filter((e) => e instanceof NavigationEnd),
      map(() => this.pathOf(this.router.url)),
    ),
    {initialValue: this.pathOf(this.router.url)},
  );

  // "+ Neuer Fang" routes to the create form, so it is pointless there. Hide it
  // on exactly /data-entry; it stays on edit routes (/data-entry/:id) and
  // elsewhere, still gated by an active Projekt.
  readonly showNewFang = computed(
    () => !!this.currentProject() && this.currentPath() !== '/data-entry',
  );

  private pathOf(url: string): string {
    return url.split('#')[0].split('?')[0];
  }

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
