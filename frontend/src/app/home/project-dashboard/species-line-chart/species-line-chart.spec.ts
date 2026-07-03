import { ComponentFixture, TestBed } from '@angular/core/testing';

import { SpeciesLineChartComponent } from './species-line-chart';
import { StatsSeries } from '../../../models/project-stats.model';

function setup(series: StatsSeries) {
  TestBed.configureTestingModule({ imports: [SpeciesLineChartComponent] });
  const fixture: ComponentFixture<SpeciesLineChartComponent> =
    TestBed.createComponent(SpeciesLineChartComponent);
  fixture.componentRef.setInput('series', series);
  fixture.detectChanges();
  return fixture;
}

describe('SpeciesLineChartComponent', () => {
  const series: StatsSeries = {
    days: ['2026-06-26', '2026-06-28', '2026-07-02'],
    lines: [
      { species_id: 'sp-1', name: 'Mönchsgrasmücke', counts: [2, 0, 8] },
      { species_id: 'sp-2', name: 'Amsel', counts: [0, 3, 6] },
      { species_id: null, name: 'Übrige', counts: [0, 0, 3] },
    ],
  };

  it('uses the actual Fangtage as the X axis and one dataset per line', () => {
    const fixture = setup(series);
    const data = fixture.componentInstance.chartData();

    // The X axis is the sparse Fangtage from the series, in order.
    expect(data.labels).toEqual(['2026-06-26', '2026-06-28', '2026-07-02']);
    // One line per Art plus Übrige — labelled by name, aligned to the days.
    expect(data.datasets.length).toBe(3);
    expect(data.datasets.map((d) => d.label)).toEqual(['Mönchsgrasmücke', 'Amsel', 'Übrige']);
    expect(data.datasets[0].data).toEqual([2, 0, 8]);
    expect(data.datasets[2].data).toEqual([0, 0, 3]);
  });

  it('registers the line controller and renders a line chart against the canvas', () => {
    const fixture = setup(series);
    expect(fixture.componentInstance.chartType).toBe('line');
    expect(fixture.nativeElement.querySelector('canvas')).not.toBeNull();
  });

  it('produces empty chart data when the series is empty', () => {
    const fixture = setup({ days: [], lines: [] });
    const data = fixture.componentInstance.chartData();
    expect(data.labels).toEqual([]);
    expect(data.datasets).toEqual([]);
  });
});
