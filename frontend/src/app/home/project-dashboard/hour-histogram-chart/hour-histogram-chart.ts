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
  type Plugin,
  Tooltip,
} from 'chart.js';

// Chart.js used directly — no Angular wrapper (ADR 0016). Register ONLY the bar
// controller/elements (plus the two scales and the tooltip a bar chart needs) so
// the bundle stays tree-shaken; the häufigste-Arten bar chart already registered
// the same set separately (registration is idempotent per type).
Chart.register(BarController, BarElement, CategoryScale, LinearScale, Tooltip);

// The 24 hour-of-day buckets, zero-padded so the axis reads "00 … 23".
const HOURS = Array.from({ length: 24 }, (_, hour) => hour.toString().padStart(2, '0'));

// The chart's meaningful accessible label (issue #296) — a <canvas> is opaque to
// assistive tech, so the histogram carries an explicit role="img" + aria-label.
const ACCESSIBLE_LABEL = 'Fangaktivität nach Tagesstunde: Fänge je Stunde des Tages';

// The Fangaktivität-nach-Tagesstunde histogram (issue #296): Fänge per Vienna
// clock hour (0–23) for the selected range, so a Beringer sees when the nets are
// most productive. Rendered imperatively against a <canvas> from the render hook
// (`afterNextRender`). The bucketing is server-side (ADR 0017); this only renders
// the 24 counts. A direct value label is drawn on the peak hour ONLY (an inline
// plugin, no external dependency) to keep the chart readable without clutter,
// while every bar still gives its exact value on hover. The data fed to the chart
// is exposed as `chartData` so specs assert the dataset/labels, not pixels.
@Component({
  selector: 'app-hour-histogram-chart',
  template: `<div class="chart-host">
    <canvas #canvas role="img" [attr.aria-label]="accessibleLabel"></canvas>
  </div>`,
  styleUrl: './hour-histogram-chart.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class HourHistogramChartComponent {
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);

  // The 24 per-hour Fänge counts (index = Vienna clock hour), served whole.
  readonly histogram = input.required<number[]>();
  readonly chartType = 'bar' as const;
  readonly accessibleLabel = ACCESSIBLE_LABEL;

  private readonly canvas = viewChild.required<ElementRef<HTMLCanvasElement>>('canvas');
  private chart?: Chart<'bar'>;

  // A single bar dataset of the per-hour Fänge, labelled by the 24 hours of the
  // day. Colour is part of the exposed structure: one scalar brand-accent
  // backgroundColor for the whole dataset — every bar wears the same accent
  // (consistent with the häufigste-Arten bar chart, issue #294), so colour is
  // brand, never an encoding of the hour.
  readonly chartData = computed<ChartData<'bar'>>(() => {
    const histogram = this.histogram();
    const accent = this.token('--mat-sys-primary', '#00658f');
    return {
      labels: HOURS,
      datasets: [
        {
          label: 'Fänge',
          data: histogram,
          backgroundColor: accent,
          borderRadius: 4,
          maxBarThickness: 28,
        },
      ],
    };
  });

  // The peak hour (index 0–23): the hour with the most Fänge, the earliest one on
  // a tie so exactly one label is ever drawn. -1 when the histogram is all zeros
  // (an empty range), so the peak-only value label degrades to no label rather
  // than an error. Exposed so specs assert it and the inline label plugin reads
  // it.
  readonly peakHour = computed<number>(() => {
    const histogram = this.histogram();
    let peak = -1;
    let max = 0;
    histogram.forEach((count, hour) => {
      if (count > max) {
        max = count;
        peak = hour;
      }
    });
    return peak;
  });

  constructor() {
    afterNextRender(() => {
      this.chart = new Chart(this.canvas().nativeElement, {
        type: this.chartType,
        data: this.chartData(),
        options: this.chartOptions(),
        plugins: [this.peakLabelPlugin()],
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

  // Draws the exact value directly over the peak hour's bar ONLY (issue #296),
  // keeping the chart readable without a label on every bar. A local inline
  // plugin (no external dependency): after the bars are drawn it paints the peak
  // count above its bar in the ink token. No peak (empty range) → nothing drawn.
  private peakLabelPlugin(): Plugin<'bar'> {
    return {
      id: 'peakHourLabel',
      afterDatasetsDraw: (chart) => {
        const peak = this.peakHour();
        if (peak < 0) return;
        const bar = chart.getDatasetMeta(0).data[peak];
        if (!bar) return;
        const value = this.histogram()[peak];
        const { ctx } = chart;
        ctx.save();
        ctx.fillStyle = this.token('--mat-sys-on-surface', '#1a1c1e');
        ctx.font = '600 12px sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'bottom';
        ctx.fillText(value.toLocaleString('de-AT'), bar.x, bar.y - 4);
        ctx.restore();
      },
    };
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
        // Every bar gives its exact value on hover; the title reads as a clock
        // hour ("06:00 Uhr") so the histogram is legible without the axis label.
        tooltip: {
          enabled: true,
          callbacks: {
            title: (items) => `${items[0]?.label}:00 Uhr`,
            label: (item) => `${item.formattedValue} Fänge`,
          },
        },
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
