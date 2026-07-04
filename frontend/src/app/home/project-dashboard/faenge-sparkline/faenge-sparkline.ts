import {
  afterNextRender,
  ChangeDetectionStrategy,
  Component,
  computed,
  DestroyRef,
  effect,
  ElementRef,
  inject,
  input,
  viewChild,
} from '@angular/core';
import {
  CategoryScale,
  Chart,
  type ChartData,
  type ChartOptions,
  LineController,
  LineElement,
  LinearScale,
  PointElement,
} from 'chart.js';

// Chart.js used directly — no Angular wrapper (ADR 0016). Register ONLY the line
// controller/elements plus the two scales a line needs; no tooltip/legend, since
// a sparkline is an axis-less, chrome-less micro-trend. Registration is
// idempotent per type (the Fänge/Fangtag line chart registers the same set).
Chart.register(LineController, LineElement, PointElement, CategoryScale, LinearScale);

// The Fänge-KPI-Tile sparkline (issue #299): the season's cumulative Fänge
// trajectory drawn as a bare trend line inside the KPI tile, so the shape of the
// season is visible without leaving the tile. The values are derived client-side
// upstream (`cumulativeFaenge`, dashboard-state) from the already-served
// per-Fangtag series — no backend change (ADR 0017). This component only renders
// them: a single line, no axes/ticks/grid/legend/tooltip/points. The data fed to
// the chart is exposed as `chartData` so specs assert the dataset, not pixels.
@Component({
  selector: 'app-faenge-sparkline',
  template: `<div class="sparkline-host">
    <canvas #canvas aria-hidden="true"></canvas>
  </div>`,
  styleUrl: './faenge-sparkline.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class FaengeSparklineComponent {
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);

  // The cumulative per-Fangtag Fänge trajectory (running totals), aligned to the
  // season's Fangtage. Derived by the dashboard from the served series.
  readonly values = input.required<number[]>();
  readonly chartType = 'line' as const;

  private readonly canvas = viewChild.required<ElementRef<HTMLCanvasElement>>('canvas');
  private chart?: Chart<'line'>;

  // A single line dataset of the running Fänge total. Colour is the brand accent
  // (the sparkline is decoration on the Fänge tile, not an encoding); no point
  // markers, so it reads as a bare trajectory. Labels are the point indices — a
  // sparkline has no visible axis, they only align the points.
  readonly chartData = computed<ChartData<'line'>>(() => {
    const values = this.values();
    const accent = this.token('--mat-sys-primary', '#00658f');
    return {
      labels: values.map((_value, index) => index),
      datasets: [
        {
          data: values,
          borderColor: accent,
          backgroundColor: accent,
          borderWidth: 2,
          pointRadius: 0,
          tension: 0.3,
          fill: false,
        },
      ],
    };
  });

  constructor() {
    afterNextRender(() => {
      this.chart = new Chart(this.canvas().nativeElement, {
        type: this.chartType,
        data: this.chartData(),
        options: this.chartOptions(),
      });
    });

    // The nav-bar project switcher and the range selector both swap the data
    // without recreating the component; re-feed the chart whenever it changes.
    effect(() => {
      const data = this.chartData();
      if (!this.chart) return;
      this.chart.data = data;
      this.chart.update();
    });

    inject(DestroyRef).onDestroy(() => this.chart?.destroy());
  }

  private token(name: string, fallback: string): string {
    const value = getComputedStyle(this.host.nativeElement).getPropertyValue(name).trim();
    return value || fallback;
  }

  // A chrome-less line: no legend, no tooltip, both axes hidden, no grid — just
  // the trajectory. `beginAtZero` keeps the rising cumulative line honest.
  private chartOptions(): ChartOptions<'line'> {
    return {
      responsive: true,
      maintainAspectRatio: false,
      animation: false,
      plugins: {
        legend: { display: false },
        tooltip: { enabled: false },
      },
      scales: {
        x: { display: false },
        y: { display: false, beginAtZero: true },
      },
      elements: { point: { radius: 0 } },
    };
  }
}
