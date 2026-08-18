import { Component, input } from '@angular/core';

@Component({
  selector: 'app-stat-tile',
  template: `
    <div class="tile" [class.large]="large()">
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
      gap: 6px;
      padding: 22px 24px 22px 21px;
      /* inset shadow instead of border-left - a real border ignores
         border-radius on that edge and pokes out past the rounded corners */
      box-shadow: var(--shadow-sm), inset 3px 0 0 0 var(--brand-500);
    }
    .tile.large .label {
      font-size: 12.5px;
      text-transform: uppercase;
      letter-spacing: 0.04em;
    }
    .tile.large .value {
      font-size: 36px;
      font-weight: 800;
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
}
