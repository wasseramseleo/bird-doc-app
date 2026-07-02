import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  input,
  signal,
} from '@angular/core';
import {DecimalPipe} from '@angular/common';
import {MatIconModule} from '@angular/material/icon';
import {MatProgressSpinnerModule} from '@angular/material/progress-spinner';

import {ApiService} from '../../service/api.service';
import {Project} from '../../models/project.model';
import {ProjectStats} from '../../models/project-stats.model';

// The current Projekt's dashboard (ADR 0018). For this slice it renders only the
// pure-text "Letzter Tag" stat card — charts arrive in later slices. Stats are
// online-only (ADR 0017): with no network it shows an error state, not offline
// data. The counting semantics all live server-side; this component only maps
// the typed response onto the card.
@Component({
  selector: 'app-project-dashboard',
  imports: [DecimalPipe, MatIconModule, MatProgressSpinnerModule],
  templateUrl: './project-dashboard.html',
  styleUrl: './project-dashboard.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ProjectDashboardComponent {
  private readonly api = inject(ApiService);

  readonly project = input.required<Project>();

  readonly stats = signal<ProjectStats | null>(null);
  readonly loading = signal<boolean>(true);
  readonly error = signal<boolean>(false);

  readonly lastFangtag = computed(() => this.stats()?.last_fangtag ?? null);

  constructor() {
    // Reload whenever the current Projekt changes (the nav-bar switcher swaps it
    // without leaving the home).
    effect(() => {
      const project = this.project();
      this.loading.set(true);
      this.error.set(false);
      this.api.getProjectStats(project.id).subscribe({
        next: (stats) => {
          this.stats.set(stats);
          this.loading.set(false);
        },
        error: () => {
          this.stats.set(null);
          this.error.set(true);
          this.loading.set(false);
        },
      });
    });
  }
}
