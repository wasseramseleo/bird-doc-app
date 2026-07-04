import { ComponentFixture, TestBed } from '@angular/core/testing';

import { HourHistogramChartComponent } from './hour-histogram-chart';

function setup(histogram: number[]) {
  TestBed.configureTestingModule({ imports: [HourHistogramChartComponent] });
  const fixture: ComponentFixture<HourHistogramChartComponent> =
    TestBed.createComponent(HourHistogramChartComponent);
  fixture.componentRef.setInput('histogram', histogram);
  fixture.detectChanges();
  return fixture;
}

describe('HourHistogramChartComponent', () => {
  // A 24-slot histogram (index = Vienna clock hour); hour 6 (=9) is the peak.
  const histogram = [0, 2, 0, 0, 0, 0, 9, 7, 5, 3, 2, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0];

  it('feeds the bar chart the 24 hour-of-day buckets as a single count dataset', () => {
    const fixture = setup(histogram);
    const data = fixture.componentInstance.chartData();

    // 24 labels, one per hour of the day (00 … 23), in order.
    expect(data.labels?.length).toBe(24);
    expect(data.labels?.[0]).toBe('00');
    expect(data.labels?.[23]).toBe('23');
    // A single bar dataset whose values are the per-hour Fänge, aligned to the hours.
    expect(data.datasets.length).toBe(1);
    expect(data.datasets[0].data).toEqual(histogram);
  });

  it('renders a bar chart against the canvas', () => {
    const fixture = setup(histogram);
    // The chart is created imperatively (Chart.js direct, ADR 0016) as a bar chart.
    expect(fixture.componentInstance.chartType).toBe('bar');
    expect(fixture.nativeElement.querySelector('canvas')).not.toBeNull();
  });

  it('draws every bar in the single brand accent, not a colour per hour', () => {
    const fixture = setup(histogram);
    const data = fixture.componentInstance.chartData();

    // One dataset with a single scalar backgroundColor — the same brand accent on
    // every bar (consistent with the häufigste-Arten bar chart, issue #294),
    // never a colour-per-hour array.
    expect(data.datasets.length).toBe(1);
    const background = data.datasets[0].backgroundColor;
    expect(typeof background).toBe('string');
    expect(background).toBeTruthy();
    expect(Array.isArray(background)).toBe(false);
  });

  it('marks the busiest hour as the peak — the only bar that gets a direct label', () => {
    // hour 6 holds 9, the single maximum.
    expect(setup(histogram).componentInstance.peakHour()).toBe(6);
  });

  it('resolves a tie for the peak to the earliest hour so exactly one label is drawn', () => {
    const tie = new Array(24).fill(0);
    tie[3] = 4;
    tie[8] = 4;
    expect(setup(tie).componentInstance.peakHour()).toBe(3);
  });

  it('has no peak hour for a zeroed (empty-range) histogram, so no label is drawn', () => {
    const fixture = setup(new Array(24).fill(0));
    const data = fixture.componentInstance.chartData();

    // The zeroed histogram still renders 24 empty bars (no error state) …
    expect(data.datasets[0].data).toEqual(new Array(24).fill(0));
    // … but there is no peak, so the peak-only value label is suppressed.
    expect(fixture.componentInstance.peakHour()).toBe(-1);
  });

  it('carries a meaningful accessible label on the chart canvas', () => {
    const fixture = setup(histogram);
    const canvas: HTMLCanvasElement = fixture.nativeElement.querySelector('canvas');
    expect(canvas.getAttribute('role')).toBe('img');
    expect(canvas.getAttribute('aria-label')).toBe(
      'Fangaktivität nach Tagesstunde: Fänge je Stunde des Tages',
    );
  });
});
