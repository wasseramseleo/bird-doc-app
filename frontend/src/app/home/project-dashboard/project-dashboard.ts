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
import {HttpErrorResponse} from '@angular/common/http';
import {takeUntilDestroyed} from '@angular/core/rxjs-interop';
import {MatIconModule} from '@angular/material/icon';
import {MatProgressSpinnerModule} from '@angular/material/progress-spinner';
import {fromEvent} from 'rxjs';

import {ApiService} from '../../service/api.service';
import {Project} from '../../models/project.model';
import {
  ProjectStats,
  ProjectStatsRangeParams,
  StatsRangePreset,
} from '../../models/project-stats.model';
import {SpeciesBarChartComponent} from './species-bar-chart/species-bar-chart';
import {SpeciesLineChartComponent} from './species-line-chart/species-line-chart';
import {classifyStatsFailure, DashboardFailure} from './dashboard-state';

// The state the dashboard body renders. `loading` covers the in-flight fetch (no
// empty/broken flash); `offline` and `error` are the two failure branches, kept
// distinct so an offline field Beringer reads "needs connection" rather than
// "broken" (ADR 0017); `empty` is a capture-less range; `populated` is the card
// + charts. (Issue #204.)
type DashboardViewState = 'loading' | DashboardFailure | 'empty' | 'populated';

// A range preset plus its German label, owned by the dashboard's range selector
// (issue #203). "per Saison" is served by *Dieses Jahr* / a custom range — no
// Saison entity exists (CONTEXT.md), so it is just a range over the Fangtage.
interface RangePresetOption {
  preset: StatsRangePreset;
  label: string;
}

// The current Projekt's dashboard (ADR 0018). Renders the "Letzter Tag" stat
// card, the häufigste-Arten bar chart and the Top-N-Fänge/Fangtag line chart,
// and owns the range selector that ties all three plus the card to one time
// story. Stats are online-only (ADR 0017): with no network it shows an error
// state, not offline data. All counting semantics live server-side; this
// component only selects the range and maps the typed response onto the views.
@Component({
  selector: 'app-project-dashboard',
  imports: [
    DecimalPipe,
    MatIconModule,
    MatProgressSpinnerModule,
    SpeciesBarChartComponent,
    SpeciesLineChartComponent,
  ],
  templateUrl: './project-dashboard.html',
  styleUrl: './project-dashboard.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ProjectDashboardComponent {
  private readonly api = inject(ApiService);

  readonly project = input.required<Project>();

  readonly presets: readonly RangePresetOption[] = [
    {preset: 'week', label: 'Letzte Woche'},
    {preset: 'month', label: 'Letzter Monat'},
    {preset: 'year', label: 'Dieses Jahr'},
    {preset: 'all', label: 'Alles'},
  ];

  // The selected range. Letzte Woche is the default (issue #203); a custom range
  // clears the preset and carries explicit from/to ISO dates.
  readonly range = signal<ProjectStatsRangeParams>({preset: 'week'});
  readonly activePreset = computed(() => this.range().preset ?? null);
  // Whether the custom-range panel (explicit from/to) is the active selection.
  readonly customActive = computed(() => this.activePreset() === null);

  // Bumped on every `online` event so the load effect re-runs on reconnect.
  // The offline state promises the stats reload automatically once the field
  // Beringer is back online (issue #204); this is what keeps that promise
  // without them having to touch the range picker or switch Projekt.
  private readonly reloadTrigger = signal(0);

  readonly stats = signal<ProjectStats | null>(null);
  readonly loading = signal<boolean>(true);
  // Null while loading or on success; 'offline' | 'error' once a fetch fails.
  // Distinguishing the two is the whole point of the online-only offline state
  // (ADR 0017, issue #204).
  readonly failure = signal<DashboardFailure | null>(null);

  readonly lastFangtag = computed(() => this.stats()?.last_fangtag ?? null);
  readonly topSpecies = computed(() => this.stats()?.top_species ?? []);
  readonly series = computed(() => this.stats()?.series ?? {days: [], lines: []});
  readonly hasSeries = computed(() => this.series().days.length > 0);

  // The single source of truth the template switches on: exactly one of the five
  // dashboard states, resolved from the fetch lifecycle.
  readonly viewState = computed<DashboardViewState>(() => {
    if (this.loading()) return 'loading';
    const failure = this.failure();
    if (failure) return failure;
    return this.lastFangtag() ? 'populated' : 'empty';
  });

  constructor() {
    // Regaining connectivity re-runs the load effect (via reloadTrigger) so the
    // offline state's promise — "sobald du wieder online bist, laden die
    // Statistiken automatisch" — is actually kept (issue #204). Same
    // fromEvent(window,'online') pattern the outbox indicator and
    // offline-readiness use.
    fromEvent(window, 'online')
      .pipe(takeUntilDestroyed())
      .subscribe(() => this.reloadTrigger.update((n) => n + 1));

    // Reload whenever the current Projekt changes (the nav-bar switcher swaps it
    // without leaving the home) or the selected range changes — one fetch feeds
    // the card, the bar chart and the line chart together. Also re-runs when the
    // browser reconnects (reloadTrigger).
    effect(() => {
      const project = this.project();
      const range = this.range();
      this.reloadTrigger();
      this.loading.set(true);
      this.failure.set(null);
      this.api.getProjectStats(project.id, range).subscribe({
        next: (stats) => {
          this.stats.set(stats);
          this.loading.set(false);
        },
        error: (err: unknown) => {
          const status = err instanceof HttpErrorResponse ? err.status : null;
          this.stats.set(null);
          this.failure.set(classifyStatsFailure(status, navigator.onLine));
          this.loading.set(false);
        },
      });
    });
  }

  selectPreset(preset: StatsRangePreset): void {
    this.range.set({preset});
  }

  // Apply a custom from/to range (explicit dates win over a preset server-side).
  // Empty inputs are omitted; an all-empty apply is ignored.
  applyCustomRange(from: string, to: string): void {
    const range: ProjectStatsRangeParams = {};
    if (from) range.from = from;
    if (to) range.to = to;
    if (range.from === undefined && range.to === undefined) return;
    this.range.set(range);
  }
}
