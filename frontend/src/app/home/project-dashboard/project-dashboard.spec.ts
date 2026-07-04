import { LOCALE_ID } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { registerLocaleData } from '@angular/common';
import localeDeAt from '@angular/common/locales/de-AT';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { provideRouter } from '@angular/router';
import { By } from '@angular/platform-browser';

// The KPI row's derived figures (Wiederfang-Anteil, Ø/Fangtag) are formatted
// de-AT (comma decimals, percent), so the tests need the locale data registered.
registerLocaleData(localeDeAt);

import { ProjectDashboardComponent } from './project-dashboard';
import { DASHBOARD_NOW } from './dashboard-state';
import { SpeciesBarChartComponent } from './species-bar-chart/species-bar-chart';
import { SpeciesLineChartComponent } from './species-line-chart/species-line-chart';
import { HourHistogramChartComponent } from './hour-histogram-chart/hour-histogram-chart';
import { FaengeSparklineComponent } from './faenge-sparkline/faenge-sparkline';
import { Project } from '../../models/project.model';
import { ProjectStats } from '../../models/project-stats.model';
import { ProjectActionsService } from '../../service/project-actions.service';

// The recency chip and the Ruhige-Phase note (issue #295) are relative to "now".
// Pin it so every populated payload has a deterministic „vor N Tagen": with the
// default last_fangtag (2026-07-02) this reads „vor 2 Tagen" (recent, not quiet).
const DEFAULT_NOW = new Date(2026, 6, 4, 10, 0, 0);

function makeProject(overrides: Partial<Project> = {}): Project {
  return {
    id: 'p1',
    title: 'Schilfgürtel Linz',
    description: '',
    show_optional_fields: false,
    organization: { id: 'o1', name: 'IWM Linz' } as Project['organization'],
    default_station: null,
    scientists: [],
    created: '2026-06-01T00:00:00Z',
    updated: '2026-06-01T00:00:00Z',
    ...overrides,
  };
}

function makeStats(overrides: Partial<ProjectStats> = {}): ProjectStats {
  return {
    range: { from: '2026-06-26', to: '2026-07-03', preset: 'week' },
    totals: { faenge: 120, artenzahl: 17, fangtage: 16, erstfaenge: 90, wiederfaenge: 30 },
    top_species: [
      { species_id: 'sp-1', name: 'Mönchsgrasmücke', count: 34 },
      { species_id: 'sp-2', name: 'Amsel', count: 21 },
    ],
    erstnachweise: [
      {
        species_id: 'sp-1',
        name: 'Mönchsgrasmücke',
        scientific_name: 'Sylvia atricapilla',
        date: '2026-07-02',
        beringer: 'a.huber',
      },
      {
        species_id: 'sp-2',
        name: 'Amsel',
        scientific_name: 'Turdus merula',
        date: '2026-06-28',
        beringer: 'b.mayer',
      },
    ],
    series: {
      days: ['2026-06-26', '2026-06-28', '2026-07-02'],
      lines: [
        { species_id: 'sp-1', name: 'Mönchsgrasmücke', counts: [10, 12, 12] },
        { species_id: 'sp-2', name: 'Amsel', counts: [5, 8, 8] },
        { species_id: null, name: 'Übrige', counts: [2, 3, 4] },
      ],
    },
    hour_histogram: [0, 0, 0, 0, 0, 3, 9, 12, 8, 5, 4, 2, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
    last_fangtag: {
      date: '2026-07-02',
      faenge: 38,
      trend: { previous_fangtag: '2026-06-28', previous_faenge: 25, delta: 13 },
      haeufigste_art: { species_id: 'sp-1', name: 'Mönchsgrasmücke', count: 12 },
      strongest_hour: { hour: 6, count: 9 },
    },
    ...overrides,
  };
}

// An ISO date `n` calendar days before today (local), for the „NEU"-threshold
// test — computed relative to now so the assertion never goes stale.
function isoDaysAgo(n: number): string {
  const d = new Date();
  d.setDate(d.getDate() - n);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function setup(project: Project, now: Date = DEFAULT_NOW) {
  // The dashboard delegates Bearbeiten/Export to the shared ProjectActionsService
  // (issue #222); the real one wires MatDialog/Router/HTTP, so stub it. Tests that
  // assert delegation read the spy; the rest just need it to not blow up.
  const actions = jasmine.createSpyObj<ProjectActionsService>('ProjectActionsService', [
    'edit',
    'exportIwm',
    'loadReferenceData',
  ]);
  TestBed.configureTestingModule({
    imports: [ProjectDashboardComponent],
    providers: [
      // Router for the header actions (Bearbeiten/Neuer Fang) and the
      // Ruhige-Phase note's „Fangtag beginnen" (routerLink → /heute).
      provideRouter([]),
      provideHttpClient(),
      provideHttpClientTesting(),
      provideNoopAnimations(),
      { provide: LOCALE_ID, useValue: 'de-AT' },
      { provide: ProjectActionsService, useValue: actions },
      // Deterministic reference clock for the recency chip / quiet-phase threshold.
      { provide: DASHBOARD_NOW, useValue: () => now },
    ],
  });
  const fixture: ComponentFixture<ProjectDashboardComponent> =
    TestBed.createComponent(ProjectDashboardComponent);
  fixture.componentRef.setInput('project', project);
  const httpMock = TestBed.inject(HttpTestingController);
  return { fixture, httpMock, actions };
}

describe('ProjectDashboardComponent', () => {
  it('renders the last Fangtag as a one-line strip: title, de-AT date, recency chip, Fänge + trend delta, häufigste Art, stärkste Stunde', () => {
    const { fixture, httpMock } = setup(makeProject());
    fixture.detectChanges(); // fires the load effect

    const req = httpMock.expectOne((r) => r.url.endsWith('/projects/p1/stats/'));
    req.flush(makeStats());
    fixture.detectChanges();

    const strip: HTMLElement | null = fixture.nativeElement.querySelector('.fangtag-strip');
    expect(strip).not.toBeNull();
    const text = strip!.textContent ?? '';
    expect(text).toContain('Letzter Fangtag');
    expect(text).toContain('02.07.2026'); // de-AT date (DD.MM.YYYY), timezone-independent
    expect(text).toContain('vor 2 Tagen'); // recency chip vs the pinned now (2026-07-04)
    expect(text).toContain('38'); // Fänge
    expect(text).toContain('+13'); // trend delta vs the previous Fangtag
    expect(text).toContain('Mönchsgrasmücke'); // häufigste Art
    expect(text).toContain('12'); // häufigste-Art count
    expect(text).toContain('6:00 Uhr'); // stärkste Stunde
    expect(text).toContain('9'); // strongest-hour count

    // The old „Letzter Tag" card heading is gone; there is no ruhige phase here.
    expect(fixture.nativeElement.textContent).not.toContain('Letzter Tag');
    expect(fixture.nativeElement.querySelector('.quiet-phase')).toBeNull();
    httpMock.verify();
  });

  it('always shows the „vor N Tagen" recency chip success-tinted at 3 Tagen or less', () => {
    // now = 2026-07-05 → the last Fangtag (2026-07-02) is exactly 3 Tage back.
    const { fixture, httpMock } = setup(makeProject(), new Date(2026, 6, 5, 9, 0, 0));
    fixture.detectChanges();
    httpMock.expectOne((r) => r.url.endsWith('/projects/p1/stats/')).flush(makeStats());
    fixture.detectChanges();

    const chip: HTMLElement | null = fixture.nativeElement.querySelector('.fangtag-strip__chip');
    expect(chip).not.toBeNull();
    expect(chip!.textContent).toContain('vor 3 Tagen');
    expect(chip!.classList).toContain('fangtag-strip__chip--recent');
    httpMock.verify();
  });

  it('shows the recency chip neutral (no success tint) above 3 Tagen', () => {
    // now = 2026-07-07 → 5 Tage back, past the ≤ 3 recency threshold.
    const { fixture, httpMock } = setup(makeProject(), new Date(2026, 6, 7, 9, 0, 0));
    fixture.detectChanges();
    httpMock.expectOne((r) => r.url.endsWith('/projects/p1/stats/')).flush(makeStats());
    fixture.detectChanges();

    const chip: HTMLElement | null = fixture.nativeElement.querySelector('.fangtag-strip__chip');
    expect(chip).not.toBeNull();
    expect(chip!.textContent).toContain('vor 5 Tagen');
    expect(chip!.classList).not.toContain('fangtag-strip__chip--recent');
    httpMock.verify();
  });

  it('still shows the recency chip (never hides it) for a long-stale last Fangtag', () => {
    // now = 2026-08-01 → 30 Tage back: the chip is always present, just neutral.
    const { fixture, httpMock } = setup(makeProject(), new Date(2026, 7, 1, 9, 0, 0));
    fixture.detectChanges();
    httpMock.expectOne((r) => r.url.endsWith('/projects/p1/stats/')).flush(makeStats());
    fixture.detectChanges();

    const chip: HTMLElement | null = fixture.nativeElement.querySelector('.fangtag-strip__chip');
    expect(chip).not.toBeNull();
    expect(chip!.textContent).toContain('vor 30 Tagen');
    expect(chip!.classList).not.toContain('fangtag-strip__chip--recent');
    httpMock.verify();
  });

  it('shows the Ruhige-Phase note (offering „Fangtag beginnen") when the last Fangtag is more than 14 Tage back', () => {
    // now = 2026-07-17 → 15 Tage back, strictly over the > 14-Tage threshold.
    const { fixture, httpMock } = setup(makeProject(), new Date(2026, 6, 17, 9, 0, 0));
    fixture.detectChanges();
    httpMock.expectOne((r) => r.url.endsWith('/projects/p1/stats/')).flush(makeStats());
    fixture.detectChanges();

    const note: HTMLElement | null = fixture.nativeElement.querySelector('.quiet-phase');
    expect(note).not.toBeNull();
    expect(note!.textContent).toContain('Ruhige Phase');

    // It offers a way to begin the next Fangtag → the Heute-Ansicht (/heute).
    const action: HTMLAnchorElement | null = note!.querySelector('.quiet-phase__action');
    expect(action).not.toBeNull();
    expect(action!.textContent).toContain('Fangtag beginnen');
    expect(action!.getAttribute('href')).toBe('/heute');

    // No auto-widening: the populated strip and the recency chip still show the
    // (old) data — the quiet phase augments the strip, it does not replace it.
    expect(fixture.nativeElement.querySelector('.fangtag-strip')).not.toBeNull();
    expect(fixture.nativeElement.querySelector('.fangtag-strip__chip')?.textContent).toContain(
      'vor 15 Tagen',
    );
    httpMock.verify();
  });

  it('does not show the Ruhige-Phase note at exactly 14 Tage (the boundary is strictly greater)', () => {
    // now = 2026-07-16 → 14 Tage back: still „normal", not a quiet phase yet.
    const { fixture, httpMock } = setup(makeProject(), new Date(2026, 6, 16, 9, 0, 0));
    fixture.detectChanges();
    httpMock.expectOne((r) => r.url.endsWith('/projects/p1/stats/')).flush(makeStats());
    fixture.detectChanges();

    expect(fixture.nativeElement.querySelector('.quiet-phase')).toBeNull();
    // The strip and its recency chip are still there.
    expect(fixture.nativeElement.querySelector('.fangtag-strip')).not.toBeNull();
    httpMock.verify();
  });

  it('keeps the quiet phase distinct from the empty state: no Ruhige-Phase note (and no strip) when the range holds no Fangtag', () => {
    // A now far past any capture, but a payload with no data in range at all.
    const { fixture, httpMock } = setup(makeProject(), new Date(2026, 7, 1, 9, 0, 0));
    fixture.detectChanges();
    httpMock.expectOne((r) => r.url.endsWith('/projects/p1/stats/')).flush(
      makeStats({
        totals: { faenge: 0, artenzahl: 0, fangtage: 0, erstfaenge: 0, wiederfaenge: 0 },
        last_fangtag: null,
      }),
    );
    fixture.detectChanges();

    // The empty-range state, not a quiet-phase note.
    expect(fixture.nativeElement.querySelector('.quiet-phase')).toBeNull();
    expect(fixture.nativeElement.querySelector('.fangtag-strip')).toBeNull();
    expect(fixture.nativeElement.querySelector('.dashboard__state--empty')).not.toBeNull();
    expect(fixture.nativeElement.textContent).toContain('keine Fänge');
    httpMock.verify();
  });

  it('issues its initial stats request with the year preset (Dieses Jahr)', () => {
    const { fixture, httpMock } = setup(makeProject());
    fixture.detectChanges(); // fires the load effect

    // The dashboard opens on „Dieses Jahr" so it answers „Wie läuft die Saison?"
    // immediately (issue #293) — the endpoint's own default (week) is untouched.
    const req = httpMock.expectOne((r) => r.url.endsWith('/projects/p1/stats/'));
    expect(req.request.params.get('preset')).toBe('year');
    req.flush(makeStats());

    // The year preset button is the active selection.
    fixture.detectChanges();
    const active: HTMLButtonElement | null = fixture.nativeElement.querySelector(
      '.range-selector__preset--active',
    );
    expect(active?.textContent?.trim()).toBe('Dieses Jahr');
    httpMock.verify();
  });

  it('renders the four-tile KPI row from the stats totals for the selected range', () => {
    const { fixture, httpMock } = setup(makeProject());
    fixture.detectChanges();

    // totals: faenge 120 (90 Erstfänge + 30 Wiederfänge), 17 Arten, 16 Fangtage.
    httpMock.expectOne((r) => r.url.endsWith('/projects/p1/stats/')).flush(makeStats());
    fixture.detectChanges();

    const tiles: HTMLElement[] = Array.from(
      fixture.nativeElement.querySelectorAll('.kpi-tile'),
    );
    expect(tiles.length).toBe(4);
    // Normalise the locale's narrow/no-break spaces (de-AT percent) to plain ones.
    const textOf = (el: HTMLElement) => (el.textContent ?? '').replace(/[  ]/g, ' ');

    // Fänge — total captures + the Erstfang composition as a sub-detail.
    expect(textOf(tiles[0])).toContain('Fänge');
    expect(textOf(tiles[0])).toContain('120');
    expect(textOf(tiles[0])).toContain('davon 90 Erstfänge');

    // Arten — species richness (Artenzahl), unchanged semantics.
    expect(textOf(tiles[1])).toContain('Arten');
    expect(textOf(tiles[1])).toContain('17');

    // Fangtage — count + Ø Fänge/Fangtag (120 / 16 = 7,5), derived client-side, de-AT.
    expect(textOf(tiles[2])).toContain('Fangtage');
    expect(textOf(tiles[2])).toContain('16');
    expect(textOf(tiles[2])).toContain('7,5');

    // Wiederfang-Anteil — recapture share (30 / 120 = 25 %) + the absolute count.
    expect(textOf(tiles[3])).toContain('Wiederfang-Anteil');
    expect(textOf(tiles[3])).toContain('25 %');
    expect(textOf(tiles[3])).toContain('30');
    httpMock.verify();
  });

  it('carries a cumulative Fänge sparkline on the Fänge KPI tile, derived from the served series', () => {
    const { fixture, httpMock } = setup(makeProject());
    fixture.detectChanges();

    httpMock.expectOne((r) => r.url.endsWith('/projects/p1/stats/')).flush(makeStats());
    fixture.detectChanges();

    // The sparkline lives inside the first KPI tile (Fänge), not free-floating.
    const tiles: HTMLElement[] = Array.from(fixture.nativeElement.querySelectorAll('.kpi-tile'));
    const faengeTile = tiles[0];
    expect((faengeTile.textContent ?? '')).toContain('Fänge');
    expect(faengeTile.querySelector('app-faenge-sparkline')).not.toBeNull();

    // It is fed the *cumulative* trajectory derived client-side from the served
    // per-Fangtag series — daily totals 17, 23, 24 → running 17, 40, 64 — with no
    // extra request (the same single stats payload feeds it).
    const spark = fixture.debugElement.query(By.directive(FaengeSparklineComponent));
    expect(spark).not.toBeNull();
    expect((spark.componentInstance as FaengeSparklineComponent).values()).toEqual([17, 40, 64]);
    httpMock.verify();
  });

  it('omits the Fänge sparkline when the range has no Fangtag series to plot', () => {
    const { fixture, httpMock } = setup(makeProject());
    fixture.detectChanges();

    // A populated last_fangtag but an empty series (a single-day range can carry a
    // last Fangtag with no multi-point trajectory) → no sparkline to draw.
    httpMock.expectOne((r) => r.url.endsWith('/projects/p1/stats/')).flush(
      makeStats({ series: { days: [], lines: [] } }),
    );
    fixture.detectChanges();

    expect(fixture.nativeElement.querySelector('app-faenge-sparkline')).toBeNull();
    httpMock.verify();
  });

  it('feeds the häufigste-Arten bar chart the top_species from the stats response', () => {
    const { fixture, httpMock } = setup(makeProject());
    fixture.detectChanges();

    httpMock.expectOne((r) => r.url.endsWith('/projects/p1/stats/')).flush(makeStats());
    fixture.detectChanges();

    const chart = fixture.debugElement.query(By.directive(SpeciesBarChartComponent));
    expect(chart).not.toBeNull();
    const chartData = (chart.componentInstance as SpeciesBarChartComponent).chartData();
    // The chart is fed the häufigsten Arten as labels + a single count dataset.
    expect(chartData.labels).toEqual(['Mönchsgrasmücke', 'Amsel']);
    expect(chartData.datasets[0].data).toEqual([34, 21]);
    httpMock.verify();
  });

  it('feeds the Fänge/Fangtag line chart the sparse days + one line per Art from the series', () => {
    const { fixture, httpMock } = setup(makeProject());
    fixture.detectChanges();

    httpMock.expectOne((r) => r.url.endsWith('/projects/p1/stats/')).flush(makeStats());
    fixture.detectChanges();

    const chart = fixture.debugElement.query(By.directive(SpeciesLineChartComponent));
    expect(chart).not.toBeNull();
    const chartData = (chart.componentInstance as SpeciesLineChartComponent).chartData();
    // The X axis is the sparse Fangtage; one dataset per Art plus Übrige.
    expect(chartData.labels).toEqual(['2026-06-26', '2026-06-28', '2026-07-02']);
    expect(chartData.datasets.map((d) => d.label)).toEqual(['Mönchsgrasmücke', 'Amsel', 'Übrige']);
    expect(chartData.datasets[0].data).toEqual([10, 12, 12]);
    httpMock.verify();
  });

  it('offers a table alternative for the Fänge/Fangtag line chart, chart shown by default (table hidden)', () => {
    const { fixture, httpMock } = setup(makeProject());
    fixture.detectChanges();
    httpMock.expectOne((r) => r.url.endsWith('/projects/p1/stats/')).flush(makeStats());
    fixture.detectChanges();

    // Default: the line chart renders, the table alternative does not.
    expect(fixture.debugElement.query(By.directive(SpeciesLineChartComponent))).not.toBeNull();
    expect(fixture.nativeElement.querySelector('table.series-table')).toBeNull();

    // The toggle invites the table view.
    const toggle: HTMLButtonElement | null = fixture.nativeElement.querySelector(
      '.chart-panel__table-toggle',
    );
    expect(toggle).not.toBeNull();
    expect(toggle!.textContent?.trim()).toBe('Als Tabelle anzeigen');
    httpMock.verify();
  });

  it('reveals the served series as a table (same data as the chart) when „Als Tabelle anzeigen" is clicked, and hides the chart', () => {
    const { fixture, httpMock } = setup(makeProject());
    fixture.detectChanges();
    httpMock.expectOne((r) => r.url.endsWith('/projects/p1/stats/')).flush(makeStats());
    fixture.detectChanges();

    const toggle: HTMLButtonElement = fixture.nativeElement.querySelector(
      '.chart-panel__table-toggle',
    );
    toggle.click();
    fixture.detectChanges();

    // The chart is swapped for a real <table> mirroring the served series.
    expect(fixture.debugElement.query(By.directive(SpeciesLineChartComponent))).toBeNull();
    const table: HTMLTableElement | null = fixture.nativeElement.querySelector('table.series-table');
    expect(table).not.toBeNull();

    const text = table!.textContent ?? '';
    // A caption plus the Fangtage as de-AT (dd.MM.yyyy) column headers.
    expect(text).toContain('Fänge pro Fangtag');
    expect(text).toContain('26.06.2026');
    expect(text).toContain('28.06.2026');
    expect(text).toContain('02.07.2026');

    // One row per Art (incl. the folded Übrige), the Art named in the row header.
    const rowHeaders = Array.from(table!.querySelectorAll('tbody th')).map((th) =>
      th.textContent?.trim(),
    );
    expect(rowHeaders).toEqual(['Mönchsgrasmücke', 'Amsel', 'Übrige']);

    // The Mönchsgrasmücke row carries its served per-Fangtag counts (10, 12, 12).
    const firstRowCells = Array.from(table!.querySelectorAll('tbody tr')[0].querySelectorAll('td'));
    expect(firstRowCells.map((td) => td.textContent?.trim())).toEqual(['10', '12', '12']);
    // The Übrige row too (2, 3, 4) — the whole series, not just the identified Arten.
    const uebrigeCells = Array.from(table!.querySelectorAll('tbody tr')[2].querySelectorAll('td'));
    expect(uebrigeCells.map((td) => td.textContent?.trim())).toEqual(['2', '3', '4']);
    httpMock.verify();
  });

  it('flips the toggle label and returns to the chart when the table alternative is toggled off again', () => {
    const { fixture, httpMock } = setup(makeProject());
    fixture.detectChanges();
    httpMock.expectOne((r) => r.url.endsWith('/projects/p1/stats/')).flush(makeStats());
    fixture.detectChanges();

    const toggle: HTMLButtonElement = fixture.nativeElement.querySelector(
      '.chart-panel__table-toggle',
    );
    expect(toggle.textContent?.trim()).toBe('Als Tabelle anzeigen');

    // Table on: the label flips to offer switching back to the chart.
    toggle.click();
    fixture.detectChanges();
    expect(toggle.textContent?.trim()).toBe('Als Diagramm anzeigen');
    expect(fixture.nativeElement.querySelector('table.series-table')).not.toBeNull();

    // Table off: back to the chart, the label flips back.
    toggle.click();
    fixture.detectChanges();
    expect(toggle.textContent?.trim()).toBe('Als Tabelle anzeigen');
    expect(fixture.nativeElement.querySelector('table.series-table')).toBeNull();
    expect(fixture.debugElement.query(By.directive(SpeciesLineChartComponent))).not.toBeNull();
    httpMock.verify();
  });

  it('feeds the Fangaktivität-nach-Tagesstunde histogram the hour_histogram from the stats response', () => {
    const { fixture, httpMock } = setup(makeProject());
    fixture.detectChanges();

    httpMock.expectOne((r) => r.url.endsWith('/projects/p1/stats/')).flush(makeStats());
    fixture.detectChanges();

    const chart = fixture.debugElement.query(By.directive(HourHistogramChartComponent));
    expect(chart).not.toBeNull();
    const chartData = (chart.componentInstance as HourHistogramChartComponent).chartData();
    // 24 hour-of-day buckets fed straight through as a single count dataset.
    expect(chartData.labels?.length).toBe(24);
    expect(chartData.datasets[0].data).toEqual([
      0, 0, 0, 0, 0, 3, 9, 12, 8, 5, 4, 2, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
    ]);
    httpMock.verify();
  });

  it('re-fetches on a range change and drives the card, the bar chart and the line chart together', () => {
    const { fixture, httpMock } = setup(makeProject());
    fixture.detectChanges();

    // Default range is Dieses Jahr (preset=year) — the season-opening default (issue #293).
    const first = httpMock.expectOne((r) => r.url.endsWith('/projects/p1/stats/'));
    expect(first.request.params.get('preset')).toBe('year');
    first.flush(makeStats());
    fixture.detectChanges();

    // Switch to Letzter Monat via the range selector.
    const buttons: HTMLButtonElement[] = Array.from(
      fixture.nativeElement.querySelectorAll('.range-selector__preset'),
    );
    const monthButton = buttons.find((b) => b.textContent?.trim() === 'Letzter Monat');
    expect(monthButton).toBeTruthy();
    monthButton!.click();
    fixture.detectChanges();

    // The range change re-fetches with the new preset.
    const second = httpMock.expectOne((r) => r.url.endsWith('/projects/p1/stats/'));
    expect(second.request.params.get('preset')).toBe('month');
    second.flush(
      makeStats({
        range: { from: '2026-06-03', to: '2026-07-03', preset: 'month' },
        top_species: [{ species_id: 'sp-9', name: 'Buchfink', count: 99 }],
        series: {
          days: ['2026-06-10', '2026-07-01'],
          lines: [{ species_id: 'sp-9', name: 'Buchfink', counts: [40, 59] }],
        },
        last_fangtag: {
          date: '2026-07-01',
          faenge: 59,
          trend: { previous_fangtag: '2026-06-10', previous_faenge: 40, delta: 19 },
          haeufigste_art: { species_id: 'sp-9', name: 'Buchfink', count: 59 },
          strongest_hour: { hour: 8, count: 20 },
        },
      }),
    );
    fixture.detectChanges();

    // The strip consumes the new data (date rendered de-AT).
    expect(fixture.nativeElement.textContent).toContain('01.07.2026');
    expect(fixture.nativeElement.textContent).toContain('Buchfink');

    // The bar chart consumes the new top_species.
    const bar = fixture.debugElement.query(By.directive(SpeciesBarChartComponent));
    expect((bar.componentInstance as SpeciesBarChartComponent).chartData().labels).toEqual([
      'Buchfink',
    ]);

    // The line chart consumes the new sparse series.
    const line = fixture.debugElement.query(By.directive(SpeciesLineChartComponent));
    const lineData = (line.componentInstance as SpeciesLineChartComponent).chartData();
    expect(lineData.labels).toEqual(['2026-06-10', '2026-07-01']);
    expect(lineData.datasets[0].data).toEqual([40, 59]);

    httpMock.verify();
  });

  it('renders an empty state (no card) when the range has no Fangtag', () => {
    const { fixture, httpMock } = setup(makeProject());
    fixture.detectChanges();

    httpMock
      .expectOne((r) => r.url.endsWith('/projects/p1/stats/'))
      .flush(
        makeStats({
          totals: { faenge: 0, artenzahl: 0, fangtage: 0, erstfaenge: 0, wiederfaenge: 0 },
          last_fangtag: null,
        }),
      );
    fixture.detectChanges();

    expect(fixture.nativeElement.querySelector('.fangtag-strip')).toBeNull();
    expect(fixture.nativeElement.textContent).toContain('keine Fänge');
    httpMock.verify();
  });

  it('shows a loading state (spinner, no card/empty/error flash) while the stats request is in flight', () => {
    const { fixture, httpMock } = setup(makeProject());
    fixture.detectChanges(); // fires the load effect; the request is now pending

    // Loading branch: a spinner, and none of the terminal states leaks through.
    expect(fixture.nativeElement.querySelector('.dashboard__state--loading')).not.toBeNull();
    expect(fixture.nativeElement.querySelector('mat-spinner')).not.toBeNull();
    expect(fixture.nativeElement.querySelector('.fangtag-strip')).toBeNull();
    expect(fixture.nativeElement.querySelector('.dashboard__state--empty')).toBeNull();
    expect(fixture.nativeElement.querySelector('.dashboard__state--offline')).toBeNull();
    expect(fixture.nativeElement.querySelector('.dashboard__state--error')).toBeNull();

    // Clean up the in-flight request.
    httpMock.expectOne((r) => r.url.endsWith('/projects/p1/stats/')).flush(makeStats());
    httpMock.verify();
  });

  it('shows a needs-connection state (not an error) when the stats fetch cannot reach the server (offline, ADR 0017)', () => {
    const { fixture, httpMock } = setup(makeProject());
    fixture.detectChanges();

    // A connectivity failure surfaces as an HttpErrorResponse with status 0.
    httpMock
      .expectOne((r) => r.url.endsWith('/projects/p1/stats/'))
      .error(new ProgressEvent('network error'));
    fixture.detectChanges();

    // Offline branch: a clear "needs connection" state, distinguishable from the
    // generic error state, and no populated card.
    expect(fixture.nativeElement.querySelector('.dashboard__state--offline')).not.toBeNull();
    expect(fixture.nativeElement.querySelector('.dashboard__state--error')).toBeNull();
    expect(fixture.nativeElement.querySelector('.fangtag-strip')).toBeNull();
    expect(fixture.nativeElement.textContent).toContain('Internetverbindung');
    httpMock.verify();
  });

  it('auto-reloads the stats when the browser comes back online after an offline failure', () => {
    const { fixture, httpMock } = setup(makeProject());
    fixture.detectChanges();

    // First fetch fails with a connectivity error → offline state.
    httpMock
      .expectOne((r) => r.url.endsWith('/projects/p1/stats/'))
      .error(new ProgressEvent('network error'));
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('.dashboard__state--offline')).not.toBeNull();

    // Regaining connectivity fires window 'online' — without touching the range
    // picker or switching Projekt, the dashboard re-fetches automatically.
    window.dispatchEvent(new Event('online'));
    fixture.detectChanges();

    const retry = httpMock.expectOne((r) => r.url.endsWith('/projects/p1/stats/'));
    retry.flush(makeStats());
    fixture.detectChanges();

    // The promised auto-reload landed: offline copy gone, strip populated.
    expect(fixture.nativeElement.querySelector('.dashboard__state--offline')).toBeNull();
    expect(fixture.nativeElement.querySelector('.fangtag-strip')).not.toBeNull();
    expect(fixture.nativeElement.textContent).toContain('Letzter Fangtag');
    httpMock.verify();
  });

  it('reduces Projektdaten to a one-line meta strip under the title: Organisation · Standard-Station · Beringer-Anzahl', () => {
    const project = makeProject({
      description: 'Reedbed-Monitoring am Nordufer',
      organization: { id: 'o1', name: 'IWM Linz' } as Project['organization'],
      scientists: [
        { id: 's1', handle: 'a.huber', full_name: 'Anna Huber' },
        { id: 's2', handle: 'b.mayer', full_name: 'Bernd Mayer' },
      ],
      default_station: { handle: 'st-nord', name: 'Station Nordufer' } as Project['default_station'],
    });
    const { fixture, httpMock } = setup(project);
    fixture.detectChanges();
    httpMock.expectOne((r) => r.url.endsWith('/projects/p1/stats/')).flush(makeStats());
    fixture.detectChanges();

    const meta: HTMLElement | null = fixture.nativeElement.querySelector('.dashboard__meta');
    expect(meta).not.toBeNull();
    const text = (meta!.textContent ?? '').replace(/\s+/g, ' ').trim();
    // The three-part strip: Organisation · Standard-Station · Beringer-Anzahl.
    expect(text).toContain('IWM Linz');
    expect(text).toContain('Station Nordufer');
    expect(text).toContain('2 Beringer');

    // The demoted card no longer spells out the full Projektdaten details on the
    // dashboard (Beschreibung, per-Beringer names): the KPI row is the first
    // substantive content, so the old full card is gone.
    expect(fixture.nativeElement.querySelector('.projektdaten')).toBeNull();
    expect(fixture.nativeElement.textContent).not.toContain('Reedbed-Monitoring am Nordufer');
    expect(fixture.nativeElement.textContent).not.toContain('Anna Huber');
    httpMock.verify();
  });

  it('shows a neutral Station placeholder and a zero Beringer-Anzahl in the meta strip when the Projekt has neither', () => {
    // makeProject() defaults: scientists [], default_station null.
    const { fixture, httpMock } = setup(makeProject());
    fixture.detectChanges();
    httpMock.expectOne((r) => r.url.endsWith('/projects/p1/stats/')).flush(makeStats());
    fixture.detectChanges();

    const meta: HTMLElement = fixture.nativeElement.querySelector('.dashboard__meta');
    const text = (meta.textContent ?? '').replace(/\s+/g, ' ').trim();
    expect(text).toContain('Keine Standard-Station');
    expect(text).toContain('0 Beringer');
    httpMock.verify();
  });

  it('offers a „Neuer Fang" header shortcut into the capture-entry flow (/data-entry)', () => {
    const { fixture, httpMock } = setup(makeProject());
    fixture.detectChanges();
    httpMock.expectOne((r) => r.url.endsWith('/projects/p1/stats/')).flush(makeStats());
    fixture.detectChanges();

    const links: HTMLAnchorElement[] = Array.from(
      fixture.nativeElement.querySelectorAll('.dashboard__actions a'),
    );
    const newFang = links.find((a) => a.textContent?.includes('Neuer Fang'));
    expect(newFang).toBeTruthy();
    expect(newFang!.getAttribute('href')).toBe('/data-entry');
    httpMock.verify();
  });

  it('opens the full Projektdaten via the „Alle Projektdaten" affordance (existing details flow)', () => {
    const project = makeProject();
    const { fixture, httpMock, actions } = setup(project);
    fixture.detectChanges();
    httpMock.expectOne((r) => r.url.endsWith('/projects/p1/stats/')).flush(makeStats());
    fixture.detectChanges();

    const more: HTMLButtonElement | null =
      fixture.nativeElement.querySelector('.dashboard__meta-more');
    expect(more).toBeTruthy();
    expect(more!.textContent?.trim()).toBe('Alle Projektdaten');
    more!.click();

    // The full-details flow is the shared edit/details flow (issue #298 keeps the
    // demotion cost-free by reusing ProjectActionsService).
    expect(actions.edit).toHaveBeenCalledOnceWith(project);
    httpMock.verify();
  });

  it('delegates Bearbeiten (header action) to ProjectActionsService.edit with the current Projekt', () => {
    const project = makeProject();
    const { fixture, httpMock, actions } = setup(project);
    fixture.detectChanges();
    httpMock.expectOne((r) => r.url.endsWith('/projects/p1/stats/')).flush(makeStats());
    fixture.detectChanges();

    const buttons: HTMLElement[] = Array.from(
      fixture.nativeElement.querySelectorAll('.dashboard__actions .dashboard__action'),
    );
    const editButton = buttons.find((b) => b.textContent?.trim() === 'Bearbeiten');
    expect(editButton).toBeTruthy();
    (editButton as HTMLButtonElement).click();

    expect(actions.edit).toHaveBeenCalledOnceWith(project);
    httpMock.verify();
  });

  it('delegates Export (header action) to ProjectActionsService.exportIwm with the current Projekt', () => {
    const project = makeProject();
    const { fixture, httpMock, actions } = setup(project);
    fixture.detectChanges();
    httpMock.expectOne((r) => r.url.endsWith('/projects/p1/stats/')).flush(makeStats());
    fixture.detectChanges();

    const exportButton: HTMLButtonElement | null = fixture.nativeElement.querySelector(
      '.dashboard__actions .dashboard__action[aria-label="Als IWM Excel exportieren"]',
    );
    expect(exportButton).toBeTruthy();
    exportButton!.click();

    expect(actions.exportIwm).toHaveBeenCalledOnceWith(project);
    httpMock.verify();
  });

  it('shows the Organisation exactly once: in the meta strip, not as a header subhead', () => {
    const project = makeProject({
      organization: { id: 'o1', name: 'IWM Linz' } as Project['organization'],
    });
    const { fixture, httpMock } = setup(project);
    fixture.detectChanges();
    httpMock.expectOne((r) => r.url.endsWith('/projects/p1/stats/')).flush(makeStats());
    fixture.detectChanges();

    // The old subhead under the <h1> is gone; the <h1> title itself stays.
    expect(fixture.nativeElement.querySelector('.dashboard__org')).toBeNull();
    expect(fixture.nativeElement.querySelector('h1')?.textContent).toContain('Schilfgürtel Linz');

    // The Organisation name appears exactly once across the whole dashboard.
    const full: string = fixture.nativeElement.textContent;
    const occurrences = full.split('IWM Linz').length - 1;
    expect(occurrences).toBe(1);
    httpMock.verify();
  });

  it('refreshes the meta strip when the project input changes (currentProject signal after an edit)', () => {
    const project = makeProject({
      scientists: [{ id: 's1', handle: 'a.huber', full_name: 'Anna Huber' }],
    });
    const { fixture, httpMock } = setup(project);
    fixture.detectChanges();
    httpMock.expectOne((r) => r.url.endsWith('/projects/p1/stats/')).flush(makeStats());
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('.dashboard__meta').textContent).toContain(
      '1 Beringer',
    );

    // A successful edit upserts + setCurrents the updated Projekt in ProjectService;
    // that currentProject signal feeds this component's `project` input. Simulate
    // that new input value — the meta strip must reflect it with no manual reload.
    fixture.componentRef.setInput(
      'project',
      makeProject({
        scientists: [
          { id: 's1', handle: 'a.huber', full_name: 'Anna Huber' },
          { id: 's9', handle: 'c.nova', full_name: 'Carla Nova' },
        ],
        default_station: { handle: 'st-x', name: 'Station Neu' } as Project['default_station'],
      }),
    );
    fixture.detectChanges();
    // The stats effect also re-runs on the input change (same currentProject path).
    httpMock.expectOne((r) => r.url.endsWith('/projects/p1/stats/')).flush(makeStats());
    fixture.detectChanges();

    const meta: string = fixture.nativeElement.querySelector('.dashboard__meta').textContent;
    expect(meta).toContain('2 Beringer');
    expect(meta).toContain('Station Neu');
    expect(meta).not.toContain('1 Beringer');
    httpMock.verify();
  });

  it('renders the Erstnachweise arrival feed newest-first (Datum de-AT, wissenschaftlicher Name, Beringer)', () => {
    const { fixture, httpMock } = setup(makeProject());
    fixture.detectChanges();

    httpMock
      .expectOne((r) => r.url.endsWith('/projects/p1/stats/'))
      .flush(
        makeStats({
          erstnachweise: [
            {
              species_id: 'sp-a',
              name: 'Neuntöter',
              scientific_name: 'Lanius collurio',
              date: '2026-07-02',
              beringer: 'Anna Huber',
            },
            {
              species_id: 'sp-b',
              name: 'Teichrohrsänger',
              scientific_name: 'Acrocephalus scirpaceus',
              date: '2026-06-20',
              beringer: 'Bernd Mayer',
            },
          ],
        }),
      );
    fixture.detectChanges();

    const items: HTMLElement[] = Array.from(
      fixture.nativeElement.querySelectorAll('.erstnachweise__item'),
    );
    expect(items.length).toBe(2);

    // Newest first: Lanius collurio (2026-07-02) before Acrocephalus (2026-06-20).
    const first = items[0].textContent ?? '';
    expect(first).toContain('Lanius collurio');
    expect(first).toContain('Anna Huber');
    // Datum rendered de-AT (dd.MM.yyyy), not the raw ISO string.
    expect(first).toContain('02.07.2026');
    expect(first).not.toContain('2026-07-02');

    const second = items[1].textContent ?? '';
    expect(second).toContain('Acrocephalus scirpaceus');
    expect(second).toContain('Bernd Mayer');
    expect(second).toContain('20.06.2026');
    httpMock.verify();
  });

  it('badges only the Erstnachweise from the last seven days as „NEU"', () => {
    const { fixture, httpMock } = setup(makeProject());
    fixture.detectChanges();

    httpMock
      .expectOne((r) => r.url.endsWith('/projects/p1/stats/'))
      .flush(
        makeStats({
          erstnachweise: [
            {
              species_id: 'sp-fresh',
              name: 'Frischart',
              scientific_name: 'Recens recens',
              date: isoDaysAgo(2), // within the last 7 days → NEU
              beringer: 'Anna Huber',
            },
            {
              species_id: 'sp-old',
              name: 'Altart',
              scientific_name: 'Vetus vetus',
              date: isoDaysAgo(30), // well outside the window → no badge
              beringer: 'Bernd Mayer',
            },
          ],
        }),
      );
    fixture.detectChanges();

    const items: HTMLElement[] = Array.from(
      fixture.nativeElement.querySelectorAll('.erstnachweise__item'),
    );
    const badgeOf = (el: HTMLElement) => el.querySelector('.erstnachweise__badge');
    // The fresh arrival (2 days old) is badged NEU; the 30-day-old one is not.
    expect(badgeOf(items[0])).not.toBeNull();
    expect(badgeOf(items[0])?.textContent?.trim()).toBe('NEU');
    expect(badgeOf(items[1])).toBeNull();
    // Exactly one NEU badge across the whole feed.
    expect(fixture.nativeElement.querySelectorAll('.erstnachweise__badge').length).toBe(1);
    httpMock.verify();
  });

  it('names the jüngster Erstnachweis in the Arten KPI so the number ties to a recent arrival', () => {
    const { fixture, httpMock } = setup(makeProject());
    fixture.detectChanges();

    httpMock
      .expectOne((r) => r.url.endsWith('/projects/p1/stats/'))
      .flush(
        makeStats({
          totals: { faenge: 120, artenzahl: 17, fangtage: 16, erstfaenge: 90, wiederfaenge: 30 },
          erstnachweise: [
            {
              species_id: 'sp-a',
              name: 'Neuntöter',
              scientific_name: 'Lanius collurio',
              date: '2026-07-02',
              beringer: 'Anna Huber',
            },
            {
              species_id: 'sp-b',
              name: 'Amsel',
              scientific_name: 'Turdus merula',
              date: '2026-06-20',
              beringer: 'Bernd Mayer',
            },
          ],
        }),
      );
    fixture.detectChanges();

    const tiles: HTMLElement[] = Array.from(fixture.nativeElement.querySelectorAll('.kpi-tile'));
    // The Arten tile (species richness) now names the jüngster (newest) Erstnachweis.
    const artenTile = tiles.find((t) => (t.textContent ?? '').includes('Arten'));
    expect(artenTile).toBeTruthy();
    expect(artenTile!.textContent).toContain('17');
    // The jüngster Erstnachweis is the newest feed entry (Neuntöter), not the older Amsel.
    expect(artenTile!.textContent).toContain('Neuntöter');
    httpMock.verify();
  });

  it('shows a generic error state (not the offline state) when the stats fetch fails server-side', () => {
    const { fixture, httpMock } = setup(makeProject());
    fixture.detectChanges();

    // A reachable-but-failing server: a non-zero status, browser online.
    httpMock
      .expectOne((r) => r.url.endsWith('/projects/p1/stats/'))
      .flush('boom', { status: 500, statusText: 'Server Error' });
    fixture.detectChanges();

    // Error branch: distinguishable from the offline "needs connection" state.
    expect(fixture.nativeElement.querySelector('.dashboard__state--error')).not.toBeNull();
    expect(fixture.nativeElement.querySelector('.dashboard__state--offline')).toBeNull();
    expect(fixture.nativeElement.querySelector('.fangtag-strip')).toBeNull();
    httpMock.verify();
  });
});
