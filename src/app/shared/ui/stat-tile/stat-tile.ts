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
          @if (hint(); as h) {
            <span class="hint" [title]="h" aria-hidden="true">?</span>
          }
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

    /* KPI-dashboard variant - icon + label row with an optional "?" hint,
       a plain bold headline number, and a colored trend line underneath -
       for pages where a stat tile is a real dashboard card, not a small
       supporting number among many. */
    .tile.large {
      gap: 10px;
      padding: 18px 20px;
    }
    .tile-head {
      display: flex;
      align-items: center;
      gap: 10px;
    }
    .tile.large .label {
      font-size: 13px;
      font-weight: 600;
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
    .hint {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      flex: none;
      width: 17px;
      height: 17px;
      margin-left: auto;
      border: 1.5px solid var(--border-strong);
      border-radius: 50%;
      color: var(--text-muted);
      font-size: 10px;
      font-weight: 700;
      cursor: default;
    }
    .tile.large .value {
      font-size: 28px;
      font-weight: 800;
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
  /** Plain-text explanation shown as a native tooltip behind a small "?" icon, top-right - only rendered when `large` is also set. */
  readonly hint = input<string | null>(null);
}
