import { ComponentFixture, TestBed } from '@angular/core/testing';

import { FaengeSparklineComponent } from './faenge-sparkline';

function setup(values: number[]) {
  TestBed.configureTestingModule({ imports: [FaengeSparklineComponent] });
  const fixture: ComponentFixture<FaengeSparklineComponent> =
    TestBed.createComponent(FaengeSparklineComponent);
  fixture.componentRef.setInput('values', values);
  fixture.detectChanges();
  return fixture;
}

describe('FaengeSparklineComponent', () => {
  it('feeds the cumulative trajectory through as a single line dataset', () => {
    const fixture = setup([17, 40, 64]);
    const data = fixture.componentInstance.chartData();

    expect(fixture.componentInstance.chartType).toBe('line');
    // One dataset — the running Fänge total, position-for-position.
    expect(data.datasets.length).toBe(1);
    expect(data.datasets[0].data).toEqual([17, 40, 64]);
    // One label per Fangtag so the points line up (the labels are opaque — a
    // sparkline carries no visible axis).
    expect(data.labels?.length).toBe(3);
  });

  it('renders a canvas (Chart.js, ADR 0016) rather than an axis-bearing chart', () => {
    const fixture = setup([1, 3, 6]);
    expect(fixture.nativeElement.querySelector('canvas')).not.toBeNull();
  });

  it('draws no per-point markers so the trajectory reads as a bare trend line', () => {
    const fixture = setup([17, 40, 64]);
    const data = fixture.componentInstance.chartData();
    expect(data.datasets[0].pointRadius).toBe(0);
  });

  it('produces an empty dataset for an empty trajectory', () => {
    const fixture = setup([]);
    const data = fixture.componentInstance.chartData();
    expect(data.datasets[0].data).toEqual([]);
    expect(data.labels).toEqual([]);
  });
});
