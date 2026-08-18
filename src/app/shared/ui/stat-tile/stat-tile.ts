import { Component, input } from '@angular/core';

@Component({
  selector: 'app-stat-tile',
  template: `
    <div class="tile" [class.large]="large()">
      @if (large()) {
        <div class="tile-head">
          @if (icon(); as i) {
            <span class="icon-badge" aria-hidden="true">{{ i }}</span>
          }
          <span class="label">{{ label() }}</span>
        </div>
      } @else {
        <span class="label">{{ label() }}</span>
      }
      <span class="value">{{ value() }}</span>
      @if (caption(); as c) {
        <span class="caption" [class.up]="trend() === 'up'" [class.down]="trend() === 'down'">
          @if (trend() === 'up') { <span aria-hidden="true">▲</span> }
          @if (trend() === 'down') { <span aria-hidden="true">▼</span> }
          {{ c }}
        </span>
      }
    </div>
  `,
  styles: `
    .tile {
      display: flex;
      flex-direction: column;
      gap: 4px;
      padding: 18px 20px;
      background: var(--surface);
      border: 1px solid var(--border);
      border-radius: var(--r-lg);
      box-shadow: var(--shadow-sm);
    }
    .label {
      font-size: 12px;
      font-weight: 600;
      color: var(--text-muted);
    }
    .value {
      font-size: 26px;
      font-weight: 650;
      letter-spacing: -0.02em;
      line-height: 1.2;
      color: var(--text);
    }
    .caption {
      font-size: 12px;
      color: var(--text-muted);
    }
    .caption.up { color: var(--brand-700); }
    .caption.down { color: var(--red-600); }

    /* KPI-dashboard variant - icon + label row, a plain bold headline
       number, and a colored trend line underneath - for pages where a
       stat tile is a real dashboard card, not a small supporting number
       among many. Square (equal width/height) so a row of these reads as
       a matched set of cards rather than plain wide rectangles. */
    .tile.large {
      flex: 0 0 210px;
      gap: 14px;
      width: 210px;
      height: 210px;
      padding: 20px 22px;
      box-sizing: border-box;
    }
    .tile-head {
      display: flex;
      align-items: flex-start;
      gap: 10px;
      /* Fixed for two lines' worth of label, so a short one-line label
         (e.g. "R Squared") and a long two-line one (e.g. "Average Error
         Percent") both leave the value starting at the same y position -
         otherwise cards in the same row visually mis-align by label length. */
      min-height: 36px;
    }
    .tile.large .label {
      font-size: 13px;
      font-weight: 600;
      line-height: 1.35;
      color: var(--text-muted);
    }
    .icon-badge {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      flex: none;
      width: 30px;
      height: 30px;
      border-radius: 8px;
      background: var(--brand-50);
      font-size: 14px;
      line-height: 1;
    }
    .tile.large .value {
      font-size: 32px;
      font-weight: 700;
      letter-spacing: -0.01em;
      color: var(--text);
    }
  `,
})
export class StatTile {
  readonly label = input.required<string>();
  readonly value = input.required<string>();
  readonly caption = input<string | null>(null);
  readonly trend = input<'up' | 'down' | 'flat'>('flat');
  readonly large = input<boolean>(false);
  /** Small emoji/symbol shown in a rounded-square badge next to the label - only rendered when `large` is also set. */
  readonly icon = input<string | null>(null);
}
