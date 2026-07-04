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

// The validated colour-vision-deficiency-safe categorical palette for the
// per-Art lines (issue #294). Colour encodes Art identity here, so every line
// must get its OWN colour: the backend folds all but the Top-N Arten into Übrige
// (SERIES_TOP_N = 8, backend/birds/project_stats.py), so a busy range yields up
// to EIGHT identified lines — the palette therefore carries eight entries so it
// never wraps and no two Arten ever share a colour. The eight are a full
// spectral spread (blue · orange · purple · green · magenta · red · gold · teal)
// kept distinguishable under simulated Protanopie/Deuteranopie/Tritanopie — no
// pair is tighter than the original five's own closest CVD pair — with every
// entry ≥ 3:1 contrast on the paper surface.
const LINE_PALETTE = [
  '#00658f',
  '#c96a00',
  '#6a51a3',
  '#2f7d32',
  '#b0447c',
  '#840b13',
  '#766319',
  '#0c9797',
];
// Übrige (always the last line) is a warm grey, dashed, so the folded rest reads
// as context rather than as a sixth Art.
const UEBRIGE_COLOR = '#8a857a';
const UEBRIGE_DASH = [6, 4];

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
  // null), aligned to `days`. Colour is part of the exposed structure so specs
  // assert per-line colour and the dashed Übrige, not pixels: each identified
  // Art walks the CVD-safe palette; the Übrige line (null id) is warm grey and
  // dashed so the named Arten read as the signal and the rest as context.
  readonly chartData = computed<ChartData<'line'>>(() => {
    const series = this.series();
    return {
      labels: series.days,
      datasets: series.lines.map((line, index) => {
        const isUebrige = line.species_id === null;
        const color = isUebrige ? UEBRIGE_COLOR : LINE_PALETTE[index % LINE_PALETTE.length];
        return {
          label: line.name,
          data: line.counts,
          borderColor: color,
          backgroundColor: color,
          borderDash: isUebrige ? UEBRIGE_DASH : [],
          pointRadius: 2,
          borderWidth: 2,
          tension: 0.25,
        };
      }),
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
