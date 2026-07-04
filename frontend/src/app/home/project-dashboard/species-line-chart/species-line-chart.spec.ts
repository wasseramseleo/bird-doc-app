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

  it('colours the identified-Art lines from the CVD-safe palette, in order', () => {
    const fixture = setup(series);
    const data = fixture.componentInstance.chartData();

    // The validated colour-vision-deficiency-safe palette (issue #294): first two
    // identified Arten take the first two palette entries, in order.
    expect(data.datasets[0].borderColor).toBe('#00658f');
    expect(data.datasets[1].borderColor).toBe('#c96a00');
    // The point/fill colour matches the line colour.
    expect(data.datasets[0].backgroundColor).toBe('#00658f');
    expect(data.datasets[1].backgroundColor).toBe('#c96a00');
  });

  it('walks the full five-colour palette across five identified Arten', () => {
    const fixture = setup({
      days: ['2026-06-26'],
      lines: [
        { species_id: 'sp-1', name: 'A', counts: [1] },
        { species_id: 'sp-2', name: 'B', counts: [1] },
        { species_id: 'sp-3', name: 'C', counts: [1] },
        { species_id: 'sp-4', name: 'D', counts: [1] },
        { species_id: 'sp-5', name: 'E', counts: [1] },
      ],
    });
    const data = fixture.componentInstance.chartData();
    expect(data.datasets.map((d) => d.borderColor)).toEqual([
      '#00658f',
      '#c96a00',
      '#6a51a3',
      '#2f7d32',
      '#b0447c',
    ]);
  });

  it('gives every identified Art a distinct colour up to the backend Top-N (8 lines)', () => {
    // The backend folds all but the Top-N Arten into Übrige (SERIES_TOP_N = 8,
    // backend/birds/project_stats.py) — so a busy range can yield up to eight
    // identified-Art lines plus Übrige. Colour encodes Art identity here, so the
    // palette must give each of the eight its own colour with NO wrap/collision.
    const fixture = setup({
      days: ['2026-06-26'],
      lines: [
        { species_id: 'sp-1', name: 'A', counts: [1] },
        { species_id: 'sp-2', name: 'B', counts: [1] },
        { species_id: 'sp-3', name: 'C', counts: [1] },
        { species_id: 'sp-4', name: 'D', counts: [1] },
        { species_id: 'sp-5', name: 'E', counts: [1] },
        { species_id: 'sp-6', name: 'F', counts: [1] },
        { species_id: 'sp-7', name: 'G', counts: [1] },
        { species_id: 'sp-8', name: 'H', counts: [1] },
        { species_id: null, name: 'Übrige', counts: [1] },
      ],
    });
    const data = fixture.componentInstance.chartData();

    // The eight identified lines walk the full eight-colour CVD-safe palette,
    // in order — lines 6-8 must NOT reuse lines 1-3's colours.
    const artColors = data.datasets.slice(0, 8).map((d) => d.borderColor as string);
    expect(artColors).toEqual([
      '#00658f',
      '#c96a00',
      '#6a51a3',
      '#2f7d32',
      '#b0447c',
      '#840b13',
      '#766319',
      '#0c9797',
    ]);
    // Every identified-Art colour is unique (colour still identifies the Art).
    expect(new Set(artColors).size).toBe(8);
  });

  it('draws the Übrige line in warm grey and dashed, distinct from the Art lines', () => {
    const fixture = setup(series);
    const data = fixture.componentInstance.chartData();

    // Übrige is the last line (species_id null): warm grey, so it reads as
    // context rather than as a sixth Art.
    const uebrige = data.datasets[2];
    expect(uebrige.borderColor).toBe('#8a857a');
    expect(uebrige.backgroundColor).toBe('#8a857a');
    // Dashed — a non-empty dash pattern — so it is visually distinct from the
    // solid identified-Art lines.
    expect(uebrige.borderDash).toBeDefined();
    expect((uebrige.borderDash as number[]).length).toBeGreaterThan(0);
  });

  it('keeps the identified-Art lines solid (no dash pattern)', () => {
    const fixture = setup(series);
    const data = fixture.componentInstance.chartData();

    // Only Übrige is dashed; the named Arten stay solid.
    expect(data.datasets[0].borderDash ?? []).toEqual([]);
    expect(data.datasets[1].borderDash ?? []).toEqual([]);
  });
});
