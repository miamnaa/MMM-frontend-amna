import { Component, computed, input } from '@angular/core';

import { seriesColor } from '../palette';

export interface GroupedBarDatum {
  label: string;
  a: number;
  aDisplay: string;
  b: number;
  bDisplay: string;
}

// Horizontal layout (e.g. ROI vs Marginal ROI - name-heavy rows read better as horizontal bars)
const HW = 720;
const HPAD = { top: 10, right: 56, bottom: 28, left: 150 };
const BAND_HEIGHT = 46;
const BAR_HEIGHT = 14;
const BAR_GAP = 4;
const H_TICKS = 5;

// Vertical layout (e.g. Budget recommendation - a real column chart, matching the reference)
const VW = 720;
const VH = 300;
const VPAD = { top: 16, right: 16, bottom: 56, left: 56 };
const V_TICKS = 5;

/**
 * Two bars per category (e.g. ROI vs Marginal ROI, current vs optimized
 * spend) sharing one real axis - a proper chart with gridlines and a
 * numeric scale, not just progress-bar tracks with numbers typed at the
 * end. `vertical` switches between a horizontal bar layout (default - long
 * channel names read better as rows) and a real vertical column chart
 * matching the budget-recommendation reference. BarChart only ever plots
 * one value per row, so this is a separate component, additive rather than
 * a breaking change to it.
 */
@Component({
  selector: 'app-grouped-bar-chart',
  template: `
    <div class="legend">
      <span class="legend-item"><span class="swatch" [style.background]="colorA"></span>{{ aLabel() }}</span>
      <span class="legend-item"><span class="swatch" [style.background]="colorB"></span>{{ bLabel() }}</span>
    </div>

    @if (vertical()) {
      <svg [attr.viewBox]="'0 0 ' + VW + ' ' + VH" preserveAspectRatio="xMidYMid meet" role="img" [attr.aria-label]="ariaLabel()">
        @for (t of yTicks(); track t.value) {
          <line [attr.x1]="VPAD.left" [attr.x2]="VW - VPAD.right" [attr.y1]="t.y" [attr.y2]="t.y" class="grid-line" />
          <text [attr.x]="VPAD.left - 8" [attr.y]="t.y + 3" text-anchor="end" class="tick">{{ t.label }}</text>
        }
        <line [attr.x1]="VPAD.left" [attr.x2]="VPAD.left" [attr.y1]="VPAD.top" [attr.y2]="vPlotBottom()" class="axis-line" />
        <line [attr.x1]="VPAD.left" [attr.x2]="VW - VPAD.right" [attr.y1]="vPlotBottom()" [attr.y2]="vPlotBottom()" class="axis-line" />

        @for (col of columns(); track col.label) {
          <rect [attr.x]="col.aX" [attr.y]="col.aY" [attr.width]="col.barWidth" [attr.height]="col.aH" [attr.fill]="colorA" rx="2" />
          <text [attr.x]="col.aX + col.barWidth / 2" [attr.y]="col.aY - 4" text-anchor="middle" class="value-label">{{ col.aDisplay }}</text>
          <rect [attr.x]="col.bX" [attr.y]="col.bY" [attr.width]="col.barWidth" [attr.height]="col.bH" [attr.fill]="colorB" rx="2" />
          <text [attr.x]="col.bX + col.barWidth / 2" [attr.y]="col.bY - 4" text-anchor="middle" class="value-label">{{ col.bDisplay }}</text>
          <text [attr.x]="col.centerX" [attr.y]="vPlotBottom() + 16" text-anchor="middle" class="row-label">{{ col.label }}</text>
        }
      </svg>
    } @else {
      <svg [attr.viewBox]="'0 0 ' + HW + ' ' + height()" preserveAspectRatio="xMidYMid meet" role="img" [attr.aria-label]="ariaLabel()">
        @for (t of xTicks(); track t.value) {
          <line [attr.x1]="t.x" [attr.x2]="t.x" [attr.y1]="HPAD.top" [attr.y2]="plotBottom()" class="grid-line" />
          <text [attr.x]="t.x" [attr.y]="plotBottom() + 16" text-anchor="middle" class="tick">{{ t.label }}</text>
        }
        <line [attr.x1]="HPAD.left" [attr.x2]="HPAD.left" [attr.y1]="HPAD.top" [attr.y2]="plotBottom()" class="axis-line" />
        <line [attr.x1]="HPAD.left" [attr.x2]="HW - HPAD.right" [attr.y1]="plotBottom()" [attr.y2]="plotBottom()" class="axis-line" />

        @for (row of rows(); track row.label) {
          <text [attr.x]="HPAD.left - 10" [attr.y]="row.centerY + 4" text-anchor="end" class="row-label">{{ row.label }}</text>
          <rect [attr.x]="HPAD.left" [attr.y]="row.aY" [attr.width]="row.aW" [attr.height]="barHeight" [attr.fill]="colorA" rx="2" />
          <text [attr.x]="HPAD.left + row.aW + 6" [attr.y]="row.aY + barHeight - 3" class="value-label">{{ row.aDisplay }}</text>
          <rect [attr.x]="HPAD.left" [attr.y]="row.bY" [attr.width]="row.bW" [attr.height]="barHeight" [attr.fill]="colorB" rx="2" />
          <text [attr.x]="HPAD.left + row.bW + 6" [attr.y]="row.bY + barHeight - 3" class="value-label">{{ row.bDisplay }}</text>
        }
      </svg>
    }
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
      font-size: 11.5px;
    }
    .value-label {
      fill: var(--chart-text);
      font-size: 10px;
      font-weight: 600;
      font-variant-numeric: tabular-nums;
    }
  `,
})
export class GroupedBarChart {
  readonly data = input.required<GroupedBarDatum[]>();
  readonly aLabel = input<string>('A');
  readonly bLabel = input<string>('B');
  readonly vertical = input<boolean>(false);
  readonly tickFormat = input<(v: number) => string>((v) => (v >= 1000 ? `${Math.round(v / 100) / 10}K` : `${Math.round(v * 100) / 100}`));

  protected readonly HW = HW;
  protected readonly HPAD = HPAD;
  protected readonly VW = VW;
  protected readonly VH = VH;
  protected readonly VPAD = VPAD;
  protected readonly barHeight = BAR_HEIGHT;
  protected readonly colorA = seriesColor(0);
  protected readonly colorB = seriesColor(1);

  private readonly maxValue = computed(() => Math.max(...this.data().flatMap((d) => [d.a, d.b]), 0.0001));

  // ---- Horizontal layout ----

  protected readonly height = computed(() => HPAD.top + Math.max(1, this.data().length) * BAND_HEIGHT + HPAD.bottom);
  protected readonly plotBottom = computed(() => this.height() - HPAD.bottom);

  private scaleX(value: number): number {
    const plotWidth = HW - HPAD.left - HPAD.right;
    return (value / this.maxValue()) * plotWidth;
  }

  readonly rows = computed(() =>
    this.data().map((d, i) => {
      const bandTop = HPAD.top + i * BAND_HEIGHT;
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
    return Array.from({ length: H_TICKS + 1 }, (_, i) => {
      const value = (max / H_TICKS) * i;
      return { value, x: HPAD.left + this.scaleX(value), label: format(value) };
    });
  });

  // ---- Vertical layout ----

  protected readonly vPlotBottom = computed(() => VH - VPAD.bottom);

  private scaleY(value: number): number {
    const plotHeight = VH - VPAD.top - VPAD.bottom;
    return (value / this.maxValue()) * plotHeight;
  }

  readonly columns = computed(() => {
    const items = this.data();
    const plotWidth = VW - VPAD.left - VPAD.right;
    const groupWidth = plotWidth / Math.max(1, items.length);
    const barWidth = Math.min(28, groupWidth * 0.28);
    // Wide enough that the $-value labels above each bar don't collide when
    // the two bars are close in height (a fixed small gap made the labels
    // overlap whenever a pair's values were similar) - scales down for many
    // categories instead of a flat pixel value that stops fitting.
    const gap = Math.min(16, Math.max(6, groupWidth * 0.1));

    return items.map((d, i) => {
      const groupStart = VPAD.left + i * groupWidth;
      const pairWidth = barWidth * 2 + gap;
      const pairStart = groupStart + (groupWidth - pairWidth) / 2;
      const aH = Math.max(2, this.scaleY(d.a));
      const bH = Math.max(2, this.scaleY(d.b));
      return {
        ...d,
        barWidth,
        aX: pairStart,
        aH,
        aY: this.vPlotBottom() - aH,
        bX: pairStart + barWidth + gap,
        bH,
        bY: this.vPlotBottom() - bH,
        centerX: groupStart + groupWidth / 2,
      };
    });
  });

  readonly yTicks = computed(() => {
    const max = this.maxValue();
    const format = this.tickFormat();
    return Array.from({ length: V_TICKS + 1 }, (_, i) => {
      const value = (max / V_TICKS) * i;
      return { value, y: this.vPlotBottom() - this.scaleY(value), label: format(value) };
    });
  });

  readonly ariaLabel = computed(
    () => `Grouped bar chart comparing ${this.aLabel()} and ${this.bLabel()} across ${this.data().length} categories`,
  );
}
