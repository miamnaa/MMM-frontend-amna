import { Component, input } from '@angular/core';

@Component({
  selector: 'app-stat-tile',
  template: `
    <div class="tile" [class.large]="large()">
      @if (large() && icon(); as i) {
        <span class="icon-badge" aria-hidden="true">{{ i }}</span>
      }
      <span class="label">{{ label() }}</span>
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

    /* KPI-dashboard variant - bigger number, bolder label, a brand accent
       edge, for pages where a stat tile is the headline figure rather than
       a small supporting number among many. */
    .tile.large {
      position: relative;
      gap: 6px;
      padding: 20px 22px 22px 21px;
      background: linear-gradient(180deg, color-mix(in srgb, var(--brand-500) 6%, var(--surface)) 0%, var(--surface) 60%);
      border-color: color-mix(in srgb, var(--brand-500) 20%, var(--border));
      /* inset shadow instead of border-left - a real border ignores
         border-radius on that edge and pokes out past the rounded corners */
      box-shadow: var(--shadow-sm), inset 3px 0 0 0 var(--brand-500);
      transition: box-shadow 0.15s, transform 0.15s;
    }
    .tile.large:hover {
      box-shadow: var(--shadow-md, var(--shadow-sm)), inset 3px 0 0 0 var(--brand-500);
      transform: translateY(-1px);
    }
    .icon-badge {
      position: absolute;
      top: 16px;
      right: 16px;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      width: 34px;
      height: 34px;
      border-radius: 50%;
      background: var(--brand-50);
      font-size: 15px;
      line-height: 1;
    }
    .tile.large .label {
      font-size: 11.5px;
      font-weight: 700;
      color: var(--text-muted);
      text-transform: uppercase;
      letter-spacing: 0.05em;
    }
    .tile.large .value {
      font-size: 34px;
      font-weight: 800;
      letter-spacing: -0.01em;
      color: var(--brand-700);
    }
  `,
})
export class StatTile {
  readonly label = input.required<string>();
  readonly value = input.required<string>();
  readonly caption = input<string | null>(null);
  readonly trend = input<'up' | 'down' | 'flat'>('flat');
  readonly large = input<boolean>(false);
  /** Small emoji/symbol shown in a circular badge, top-right - only rendered when `large` is also set. */
  readonly icon = input<string | null>(null);
}
