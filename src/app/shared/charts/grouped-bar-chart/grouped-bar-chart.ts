import { Component, computed, input } from '@angular/core';

import { seriesColor } from '../palette';

export interface GroupedBarDatum {
  label: string;
  a: number;
  aDisplay: string;
  b: number;
  bDisplay: string;
}

const W = 720;
const PAD = { top: 10, right: 56, bottom: 28, left: 150 };
const BAND_HEIGHT = 46;
const BAR_HEIGHT = 14;
const BAR_GAP = 4;
const X_TICKS = 5;

/**
 * Two horizontal bars per category (e.g. ROI vs Marginal ROI, current vs
 * optimized spend) sharing one real axis - a proper chart with gridlines
 * and a numeric scale, not just two progress-bar tracks stacked with
 * numbers typed on the end. BarChart only ever plots one value per row,
 * so this is a separate component, additive rather than a breaking change.
 */
@Component({
  selector: 'app-grouped-bar-chart',
  template: `
    <div class="legend">
      <span class="legend-item"><span class="swatch" [style.background]="colorA"></span>{{ aLabel() }}</span>
      <span class="legend-item"><span class="swatch" [style.background]="colorB"></span>{{ bLabel() }}</span>
    </div>
    <svg [attr.viewBox]="'0 0 ' + W + ' ' + height()" preserveAspectRatio="xMidYMid meet" role="img" [attr.aria-label]="ariaLabel()">
      @for (t of xTicks(); track t.value) {
        <line [attr.x1]="t.x" [attr.x2]="t.x" [attr.y1]="PAD.top" [attr.y2]="plotBottom()" class="grid-line" />
        <text [attr.x]="t.x" [attr.y]="plotBottom() + 16" text-anchor="middle" class="tick">{{ t.label }}</text>
      }
      <line [attr.x1]="PAD.left" [attr.x2]="PAD.left" [attr.y1]="PAD.top" [attr.y2]="plotBottom()" class="axis-line" />
      <line [attr.x1]="PAD.left" [attr.x2]="W - PAD.right" [attr.y1]="plotBottom()" [attr.y2]="plotBottom()" class="axis-line" />

      @for (row of rows(); track row.label) {
        <text [attr.x]="PAD.left - 10" [attr.y]="row.centerY + 4" text-anchor="end" class="row-label">{{ row.label }}</text>
        <rect [attr.x]="PAD.left" [attr.y]="row.aY" [attr.width]="row.aW" [attr.height]="barHeight" [attr.fill]="colorA" rx="2" />
        <text [attr.x]="PAD.left + row.aW + 6" [attr.y]="row.aY + barHeight - 3" class="value-label">{{ row.aDisplay }}</text>
        <rect [attr.x]="PAD.left" [attr.y]="row.bY" [attr.width]="row.bW" [attr.height]="barHeight" [attr.fill]="colorB" rx="2" />
        <text [attr.x]="PAD.left + row.bW + 6" [attr.y]="row.bY + barHeight - 3" class="value-label">{{ row.bDisplay }}</text>
      }
    </svg>
  `,
  styles: `
    .legend {
      display: flex;
      gap: 16px;
      margin-bottom: 12px;
      font-size: 12px;
      color: var(--text-muted);
    }
    .legend-item {
      display: flex;
      align-items: center;
      gap: 6px;
    }
    .swatch {
      width: 10px;
      height: 10px;
      border-radius: 2px;
      flex: none;
    }
    svg {
      width: 100%;
      height: auto;
      display: block;
    }
    .grid-line {
      stroke: var(--chart-grid);
      stroke-width: 1;
    }
    .axis-line {
      stroke: var(--chart-axis);
      stroke-width: 1;
    }
    .tick {
      fill: var(--chart-label);
      font-size: 11px;
    }
    .row-label {
      fill: var(--chart-text);
      font-size: 12px;
    }
    .value-label {
      fill: var(--chart-text);
      font-size: 11px;
      font-weight: 600;
      font-variant-numeric: tabular-nums;
    }
  `,
})
export class GroupedBarChart {
  readonly data = input.required<GroupedBarDatum[]>();
  readonly aLabel = input<string>('A');
  readonly bLabel = input<string>('B');
  readonly tickFormat = input<(v: number) => string>((v) => (v >= 1000 ? `${Math.round(v / 100) / 10}K` : `${Math.round(v * 100) / 100}`));

  protected readonly W = W;
  protected readonly PAD = PAD;
  protected readonly barHeight = BAR_HEIGHT;
  protected readonly colorA = seriesColor(0);
  protected readonly colorB = seriesColor(1);

  protected readonly height = computed(() => PAD.top + Math.max(1, this.data().length) * BAND_HEIGHT + PAD.bottom);
  protected readonly plotBottom = computed(() => this.height() - PAD.bottom);

  private readonly maxValue = computed(() => Math.max(...this.data().flatMap((d) => [d.a, d.b]), 0.0001));

  private scaleX(value: number): number {
    const plotWidth = W - PAD.left - PAD.right;
    return (value / this.maxValue()) * plotWidth;
  }

  readonly rows = computed(() =>
    this.data().map((d, i) => {
      const bandTop = PAD.top + i * BAND_HEIGHT;
      const aY = bandTop + 4;
      const bY = aY + BAR_HEIGHT + BAR_GAP;
      return {
        ...d,
        aY,
        bY,
        aW: Math.max(2, this.scaleX(d.a)),
        bW: Math.max(2, this.scaleX(d.b)),
        centerY: bandTop + BAND_HEIGHT / 2,
      };
    }),
  );

  readonly xTicks = computed(() => {
    const max = this.maxValue();
    const format = this.tickFormat();
    return Array.from({ length: X_TICKS + 1 }, (_, i) => {
      const value = (max / X_TICKS) * i;
      return { value, x: PAD.left + this.scaleX(value), label: format(value) };
    });
  });

  readonly ariaLabel = computed(
    () => `Grouped bar chart comparing ${this.aLabel()} and ${this.bLabel()} across ${this.data().length} categories`,
  );
}
