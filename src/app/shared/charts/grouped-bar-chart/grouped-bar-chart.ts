import { Component, computed, input } from '@angular/core';

import { seriesColor } from '../palette';

export interface GroupedBarDatum {
  label: string;
  a: number;
  aDisplay: string;
  b: number;
  bDisplay: string;
}

/**
 * Two horizontal bars per category (e.g. ROI vs Marginal ROI, current vs
 * recommended spend), sharing one scale so the pair is directly comparable -
 * the two-series version of BarChart, which only ever plots one value per row.
 */
@Component({
  selector: 'app-grouped-bar-chart',
  template: `
    <div class="legend">
      <span class="legend-item"><span class="swatch" [style.background]="colorA"></span>{{ aLabel() }}</span>
      <span class="legend-item"><span class="swatch" [style.background]="colorB"></span>{{ bLabel() }}</span>
    </div>
    <div class="chart">
      @for (row of rows(); track row.label) {
        <div class="group" [attr.title]="row.label">
          <span class="name">{{ row.label }}</span>
          <div class="bars">
            <div class="bar-row">
              <div class="track">
                <div class="bar" [style.width.%]="row.aPct" [style.background]="colorA"></div>
              </div>
              <span class="value">{{ row.aDisplay }}</span>
            </div>
            <div class="bar-row">
              <div class="track">
                <div class="bar" [style.width.%]="row.bPct" [style.background]="colorB"></div>
              </div>
              <span class="value">{{ row.bDisplay }}</span>
            </div>
          </div>
        </div>
      }
    </div>
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
    .chart {
      display: flex;
      flex-direction: column;
      gap: 14px;
    }
    .group {
      display: grid;
      grid-template-columns: 122px 1fr;
      gap: 12px;
      align-items: center;
    }
    .name {
      font-size: 12.5px;
      color: var(--gray-700);
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .bars {
      display: flex;
      flex-direction: column;
      gap: 4px;
    }
    .bar-row {
      display: grid;
      grid-template-columns: 1fr 74px;
      align-items: center;
      gap: 10px;
    }
    .track {
      height: 8px;
      border-radius: var(--r-full);
      background: var(--gray-100);
      overflow: hidden;
    }
    .bar {
      height: 100%;
      border-radius: 0 4px 4px 0;
      min-width: 3px;
      transition: width 0.4s ease;
    }
    .value {
      font-size: 11.5px;
      font-weight: 600;
      font-variant-numeric: tabular-nums;
      text-align: right;
      color: var(--text);
    }
  `,
})
export class GroupedBarChart {
  readonly data = input.required<GroupedBarDatum[]>();
  readonly aLabel = input<string>('A');
  readonly bLabel = input<string>('B');

  protected readonly colorA = seriesColor(0);
  protected readonly colorB = seriesColor(1);

  readonly rows = computed(() => {
    const items = this.data();
    const max = Math.max(...items.flatMap((d) => [d.a, d.b]), 0.0001);
    return items.map((d) => ({ ...d, aPct: (d.a / max) * 100, bPct: (d.b / max) * 100 }));
  });
}
