import { ComponentFixture, TestBed } from '@angular/core/testing';

import { SpeciesBarChartComponent } from './species-bar-chart';
import { TopSpecies } from '../../../models/project-stats.model';

function setup(species: TopSpecies[]) {
  TestBed.configureTestingModule({ imports: [SpeciesBarChartComponent] });
  const fixture: ComponentFixture<SpeciesBarChartComponent> =
    TestBed.createComponent(SpeciesBarChartComponent);
  fixture.componentRef.setInput('species', species);
  fixture.detectChanges();
  return fixture;
}

describe('SpeciesBarChartComponent', () => {
  const top: TopSpecies[] = [
    { species_id: 'sp-1', name: 'Mönchsgrasmücke', count: 34 },
    { species_id: 'sp-2', name: 'Amsel', count: 21 },
    { species_id: 'ai', name: 'Unbekannte Art (Aves ignota)', count: 7 },
  ];

  it('feeds the bar chart one dataset of the häufigste-Arten counts, labelled by species name, in order', () => {
    const fixture = setup(top);
    const data = fixture.componentInstance.chartData();

    // Labels are the species names, in the order given (already sorted desc by the API).
    expect(data.labels).toEqual(['Mönchsgrasmücke', 'Amsel', 'Unbekannte Art (Aves ignota)']);
    // A single bar dataset whose values are the Fänge counts, aligned to the labels.
    expect(data.datasets.length).toBe(1);
    expect(data.datasets[0].data).toEqual([34, 21, 7]);
  });

  it('renders a bar chart of the given type against the canvas', () => {
    const fixture = setup(top);
    // The chart is created imperatively (Chart.js direct, ADR 0016) as a bar chart.
    expect(fixture.componentInstance.chartType).toBe('bar');
    expect(fixture.nativeElement.querySelector('canvas')).not.toBeNull();
  });

  it('produces empty chart data when there are no species', () => {
    const fixture = setup([]);
    const data = fixture.componentInstance.chartData();
    expect(data.labels).toEqual([]);
    expect(data.datasets[0].data).toEqual([]);
  });

  it('draws every bar in the single brand accent, not a colour per species', () => {
    const fixture = setup(top);
    const data = fixture.componentInstance.chartData();

    // One dataset whose backgroundColor is a single scalar string — that one
    // colour applies to every bar, so colour encodes rank (bar height), never
    // species identity (issue #294). A per-species chart would carry an array.
    expect(data.datasets.length).toBe(1);
    const background = data.datasets[0].backgroundColor;
    expect(typeof background).toBe('string');
    expect(background).toBeTruthy();
    expect(Array.isArray(background)).toBe(false);
  });
});
