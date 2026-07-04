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
  BarController,
  BarElement,
  CategoryScale,
  Chart,
  type ChartData,
  type ChartOptions,
  LinearScale,
  Tooltip,
} from 'chart.js';

import { TopSpecies } from '../../../models/project-stats.model';

// Chart.js used directly — no Angular wrapper (ADR 0016). Register ONLY the bar
// controller/elements (plus the two scales and the tooltip a bar chart needs)
// so the bundle stays tree-shaken; adding another chart type later is a
// deliberate, explicit registration, not a surprise.
Chart.register(BarController, BarElement, CategoryScale, LinearScale, Tooltip);

// The häufigste-Arten bar chart (issue #202). Rendered imperatively against a
// <canvas> from the component's render hook (`afterNextRender`), themed through
// the app's Material tokens so it reads as one product. The data fed to the
// chart is exposed as `chartData` so tests assert datasets/labels, not pixels.
@Component({
  selector: 'app-species-bar-chart',
  template: `<div class="chart-host"><canvas #canvas></canvas></div>`,
  styleUrl: './species-bar-chart.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class SpeciesBarChartComponent {
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);

  readonly species = input.required<TopSpecies[]>();
  readonly chartType = 'bar' as const;

  private readonly canvas = viewChild.required<ElementRef<HTMLCanvasElement>>('canvas');
  private chart?: Chart<'bar'>;

  // A single bar dataset of the Fänge counts, labelled by species name, aligned
  // to the order the API already sorted them in (häufigste zuerst). Colour is
  // part of the exposed structure: one scalar brand-accent backgroundColor for
  // the whole dataset, so every bar wears the same colour — it encodes rank (bar
  // height), never species identity (issue #294) — and the chart matches the
  // rest of the app rather than reading as a bolted-on widget.
  readonly chartData = computed<ChartData<'bar'>>(() => {
    const species = this.species();
    const accent = this.token('--mat-sys-primary', '#00658f');
    return {
      labels: species.map((s) => s.name),
      datasets: [
        {
          label: 'Fänge',
          data: species.map((s) => s.count),
          backgroundColor: accent,
          borderRadius: 4,
          maxBarThickness: 48,
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

    // The nav-bar project switcher swaps the current Projekt without leaving the
    // home; re-feed the chart whenever the data changes.
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

  private chartOptions(): ChartOptions<'bar'> {
    const onSurface = this.token('--mat-sys-on-surface', '#1a1c1e');
    const outline = this.token('--mat-sys-outline-variant', '#c3c7cf');
    return {
      responsive: true,
      maintainAspectRatio: false,
      animation: false,
      plugins: {
        legend: { display: false },
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
