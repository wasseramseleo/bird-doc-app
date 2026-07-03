import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { By } from '@angular/platform-browser';

import { ProjectDashboardComponent } from './project-dashboard';
import { SpeciesBarChartComponent } from './species-bar-chart/species-bar-chart';
import { Project } from '../../models/project.model';
import { ProjectStats } from '../../models/project-stats.model';

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
    totals: { faenge: 142, artenzahl: 17 },
    top_species: [
      { species_id: 'sp-1', name: 'Mönchsgrasmücke', count: 34 },
      { species_id: 'sp-2', name: 'Amsel', count: 21 },
    ],
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

function setup(project: Project) {
  TestBed.configureTestingModule({
    imports: [ProjectDashboardComponent],
    providers: [provideHttpClient(), provideHttpClientTesting(), provideNoopAnimations()],
  });
  const fixture: ComponentFixture<ProjectDashboardComponent> =
    TestBed.createComponent(ProjectDashboardComponent);
  fixture.componentRef.setInput('project', project);
  const httpMock = TestBed.inject(HttpTestingController);
  return { fixture, httpMock };
}

describe('ProjectDashboardComponent', () => {
  it('fetches stats for the current project and renders the Letzter Tag card', () => {
    const { fixture, httpMock } = setup(makeProject());
    fixture.detectChanges(); // fires the load effect

    const req = httpMock.expectOne((r) => r.url.endsWith('/projects/p1/stats/'));
    req.flush(makeStats());
    fixture.detectChanges();

    const text: string = fixture.nativeElement.textContent;
    expect(text).toContain('Letzter Tag');
    expect(text).toContain('2026-07-02');
    expect(text).toContain('38'); // Fänge
    expect(text).toContain('Mönchsgrasmücke');
    expect(text).toContain('12'); // häufigste Art count
    expect(text).toContain('6:00 Uhr'); // stärkste Stunde
    expect(text).toContain('9'); // strongest-hour count
    // Trend vs the previous Fangtag (delta +13 against 2026-06-28).
    expect(text).toContain('13');
    expect(text).toContain('2026-06-28');

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

  it('renders an empty state (no card) when the range has no Fangtag', () => {
    const { fixture, httpMock } = setup(makeProject());
    fixture.detectChanges();

    httpMock
      .expectOne((r) => r.url.endsWith('/projects/p1/stats/'))
      .flush(makeStats({ totals: { faenge: 0, artenzahl: 0 }, last_fangtag: null }));
    fixture.detectChanges();

    expect(fixture.nativeElement.querySelector('.stat-card')).toBeNull();
    expect(fixture.nativeElement.textContent).toContain('keine Fänge');
    httpMock.verify();
  });

  it('shows a needs-connection state when the stats request errors (online-only, ADR 0017)', () => {
    const { fixture, httpMock } = setup(makeProject());
    fixture.detectChanges();

    httpMock
      .expectOne((r) => r.url.endsWith('/projects/p1/stats/'))
      .error(new ProgressEvent('network error'));
    fixture.detectChanges();

    expect(fixture.nativeElement.querySelector('.stat-card')).toBeNull();
    expect(fixture.nativeElement.textContent).toContain('Internetverbindung');
    httpMock.verify();
  });
});
