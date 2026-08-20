import { Component, computed, input } from '@angular/core';

import { seriesColor } from '../palette';

export interface BarDatum {
  label: string;
  value: number;
  display: string;
}

/**
 * Horizontal magnitude bars. Each bar is directly labelled, which is also the
 * relief for the two palette slots that fall below 3:1 on a white surface.
 */
@Component({
  selector: 'app-bar-chart',
  template: `
    <div class="chart">
      @for (row of rows(); track row.label) {
        <div class="row" [attr.title]="row.label + ' — ' + row.display">
          <span class="name">{{ row.label }}</span>
          <div class="track">
            <div class="bar" [style.width.%]="row.pct" [style.background]="row.color"></div>
          </div>
          <span class="value">{{ row.display }}</span>
        </div>
      }
    </div>
  `,
  styles: `
    .chart {
      display: flex;
      flex-direction: column;
      gap: 12px;
    }
    .row {
      display: grid;
      grid-template-columns: 122px 1fr 74px;
      align-items: center;
      gap: 12px;
    }
    .name {
      font-size: 12.5px;
      color: var(--gray-700);
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .track {
      height: 10px;
      border-radius: var(--r-full);
      background: var(--gray-100);
      overflow: hidden;
    }
    .bar {
      height: 100%;
      border-radius: 0 4px 4px 0;
      transition: width 0.4s ease;
      min-width: 3px;
    }
    .value {
      font-size: 12.5px;
      font-weight: 600;
      font-variant-numeric: tabular-nums;
      text-align: right;
      color: var(--text);
    }
  `,
})
export class BarChart {
  readonly data = input.required<BarDatum[]>();
  /** True for a single-metric chart (e.g. "share of X per category") where every bar is the same thing measured, so one consistent color reads correctly - false (default) keeps the per-row rainbow for charts where color is doing real category-identity work. */
  readonly uniform = input<boolean>(false);
  /** Optional override for the default accessibility-validated categorical palette - e.g. a brand color set for a specific page. Falls back to the default palette when not provided, so every other chart using this component is unaffected. */
  readonly colors = input<string[] | null>(null);

  private colorAt(index: number): string {
    const custom = this.colors();
    return custom && custom.length > 0 ? custom[index % custom.length] : seriesColor(index);
  }

  readonly rows = computed(() => {
    const items = this.data();
    const max = Math.max(...items.map((d) => d.value), 0.0001);
    const uniform = this.uniform();
    return items.map((d, i) => ({
      ...d,
      pct: (d.value / max) * 100,
      color: uniform ? this.colorAt(0) : this.colorAt(i),
    }));
  });
}
