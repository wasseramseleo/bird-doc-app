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
  Legend,
  LineController,
  LineElement,
  LinearScale,
  PointElement,
  Tooltip,
} from 'chart.js';

import { StatsSeries } from '../../../models/project-stats.model';

// Chart.js used directly — no Angular wrapper (ADR 0016). Register ONLY the line
// controller/elements (plus the two scales, the tooltip and the legend a
// multi-line chart needs) so the bundle stays tree-shaken; the bar chart already
// registered the bar controller separately (registration is idempotent per type).
Chart.register(LineController, LineElement, PointElement, CategoryScale, LinearScale, Tooltip, Legend);

// A small, colour-blind-safe categorical palette for the per-Art lines. Übrige
// (always the last line) reuses the muted grey at the end.
const LINE_PALETTE = [
  '#00658f',
  '#984ea3',
  '#4daf4a',
  '#ff7f00',
  '#e41a1c',
  '#a65628',
  '#f781bf',
  '#377eb8',
];
const UEBRIGE_COLOR = '#9e9e9e';

// The Top-N-Fänge/Fangtag line chart (issue #203). Rendered imperatively against
// a <canvas> from the component's render hook (`afterNextRender`). One line per
// Art plus the folded `Übrige` line; the X axis is the actual sparse Fangtage.
// The data fed to the chart is exposed as `chartData` so tests assert
// datasets/labels, not pixels.
@Component({
  selector: 'app-species-line-chart',
  template: `<div class="chart-host"><canvas #canvas></canvas></div>`,
  styleUrl: './species-line-chart.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class SpeciesLineChartComponent {
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);

  readonly series = input.required<StatsSeries>();
  readonly chartType = 'line' as const;

  private readonly canvas = viewChild.required<ElementRef<HTMLCanvasElement>>('canvas');
  private chart?: Chart<'line'>;

  // The X axis is the sparse Fangtage; each series line becomes one dataset of
  // per-Fangtag Fänge counts, labelled by species name (Übrige is `species_id`
  // null), aligned to `days`.
  readonly chartData = computed<ChartData<'line'>>(() => {
    const series = this.series();
    return {
      labels: series.days,
      datasets: series.lines.map((line) => ({
        label: line.name,
        data: line.counts,
      })),
    };
  });

  constructor() {
    afterNextRender(() => {
      const themed = this.applyTheme(this.chartData());
      this.chart = new Chart(this.canvas().nativeElement, {
        type: this.chartType,
        data: themed,
        options: this.chartOptions(),
      });
    });

    // The nav-bar project switcher and the range selector both swap the data
    // without recreating the component; re-feed the chart whenever it changes.
    effect(() => {
      const data = this.applyTheme(this.chartData());
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

  // Colour each line from the categorical palette; the Übrige line (null id) is
  // muted grey so the named Arten read as the signal and the rest as context.
  private applyTheme(data: ChartData<'line'>): ChartData<'line'> {
    const lines = this.series().lines;
    return {
      labels: data.labels,
      datasets: data.datasets.map((dataset, index) => {
        const color =
          lines[index]?.species_id === null
            ? UEBRIGE_COLOR
            : LINE_PALETTE[index % LINE_PALETTE.length];
        return {
          ...dataset,
          borderColor: color,
          backgroundColor: color,
          pointRadius: 2,
          borderWidth: 2,
          tension: 0.25,
        };
      }),
    };
  }

  private chartOptions(): ChartOptions<'line'> {
    const onSurface = this.token('--mat-sys-on-surface', '#1a1c1e');
    const outline = this.token('--mat-sys-outline-variant', '#c3c7cf');
    return {
      responsive: true,
      maintainAspectRatio: false,
      animation: false,
      interaction: { mode: 'index', intersect: false },
      plugins: {
        legend: { display: true, position: 'bottom', labels: { color: onSurface } },
        tooltip: { enabled: true },
      },
      scales: {
        x: {
          ticks: { color: onSurface, autoSkip: false },
          grid: { display: false },
        },
        y: {
          beginAtZero: true,
          ticks: { color: onSurface, precision: 0 },
          grid: { color: outline },
        },
      },
    };
  }
}
