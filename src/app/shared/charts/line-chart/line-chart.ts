import { Component, computed, input, signal } from '@angular/core';

import { CHART_INK, seriesColor } from '../palette';

export interface LineSeries {
  name: string;
  points: { x: number; y: number }[];
  marker?: { x: number; label: string } | null;
}

const W = 720;
const H = 300;
const PAD = { top: 16, right: 116, bottom: 34, left: 58 };

/**
 * Multi-series line chart on a single y axis (never two scales).
 * Series identity is carried by a legend plus a direct label at each line end,
 * so colour is never the only channel.
 */
@Component({
  selector: 'app-line-chart',
  template: `
    <div class="wrap">
      <svg
        [attr.viewBox]="'0 0 ' + W + ' ' + H"
        preserveAspectRatio="xMidYMid meet"
        role="img"
        [attr.aria-label]="ariaLabel()"
        (mousemove)="onMove($event)"
        (mouseleave)="hoverX.set(null)"
      >
        <!-- gridlines -->
        @for (t of yTicks(); track t.value) {
          <line
            [attr.x1]="PAD.left"
            [attr.x2]="W - PAD.right"
            [attr.y1]="t.y"
            [attr.y2]="t.y"
            [attr.stroke]="ink.grid"
            stroke-width="1"
          />
          <text
            [attr.x]="PAD.left - 10"
            [attr.y]="t.y + 4"
            text-anchor="end"
            [attr.fill]="ink.label"
            font-size="11"
          >
            {{ t.label }}
          </text>
        }

        <!-- x axis -->
        <line
          [attr.x1]="PAD.left"
          [attr.x2]="W - PAD.right"
          [attr.y1]="H - PAD.bottom"
          [attr.y2]="H - PAD.bottom"
          [attr.stroke]="ink.axis"
          stroke-width="1"
        />
        @for (t of xTicks(); track t.value) {
          <text
            [attr.x]="t.x"
            [attr.y]="H - PAD.bottom + 18"
            text-anchor="middle"
            [attr.fill]="ink.label"
            font-size="11"
          >
            {{ t.label }}
          </text>
        }

        <!-- hover crosshair -->
        @if (hoverX() !== null) {
          <line
            [attr.x1]="hoverX()"
            [attr.x2]="hoverX()"
            [attr.y1]="PAD.top"
            [attr.y2]="H - PAD.bottom"
            [attr.stroke]="ink.axis"
            stroke-width="1"
            stroke-dasharray="3 3"
          />
        }

        <!-- series -->
        @for (s of paths(); track s.name) {
          <path [attr.d]="s.d" fill="none" [attr.stroke]="s.color" stroke-width="2" stroke-linejoin="round" />
          @if (s.marker) {
            <circle
              [attr.cx]="s.marker.cx"
              [attr.cy]="s.marker.cy"
              r="5"
              [attr.fill]="s.color"
              [attr.stroke]="ink.surface"
              stroke-width="2"
            />
          }
          <text
            [attr.x]="W - PAD.right + 10"
            [attr.y]="s.endY + 4"
            [attr.fill]="ink.text"
            font-size="11.5"
            font-weight="600"
          >
            {{ s.name }}
          </text>
        }
      </svg>

      @if (tooltip(); as tip) {
        <div class="tooltip" [style.left.%]="tip.leftPct">
          <div class="tip-x">{{ xLabel() }} {{ tip.x }}</div>
          @for (r of tip.rows; track r.name) {
            <div class="tip-row">
              <span class="swatch" [style.background]="r.color"></span>
              <span class="tip-name">{{ r.name }}</span>
              <span class="tip-val">{{ r.y }}</span>
            </div>
          }
        </div>
      }
    </div>
  `,
  styles: `
    .wrap {
      position: relative;
    }
    svg {
      width: 100%;
      height: auto;
      display: block;
    }
    .tooltip {
      position: absolute;
      top: 8px;
      transform: translateX(-50%);
      min-width: 160px;
      padding: 9px 11px;
      background: var(--surface);
      border: 1px solid var(--border);
      border-radius: var(--r-md);
      box-shadow: var(--shadow-lg);
      pointer-events: none;
      font-size: 12px;
      z-index: 2;
    }
    .tip-x {
      font-weight: 600;
      margin-bottom: 6px;
      color: var(--text);
    }
    .tip-row {
      display: flex;
      align-items: center;
      gap: 7px;
      padding: 2px 0;
    }
    .swatch {
      width: 8px;
      height: 8px;
      border-radius: 2px;
      flex: none;
    }
    .tip-name {
      color: var(--text-muted);
      flex: 1;
      white-space: nowrap;
    }
    .tip-val {
      font-weight: 600;
      font-variant-numeric: tabular-nums;
    }
  `,
})
export class LineChart {
  readonly series = input.required<LineSeries[]>();
  readonly xLabel = input<string>('Spend');
  readonly formatX = input<(v: number) => string>((v) => String(v));
  readonly formatY = input<(v: number) => string>((v) => String(v));

  protected readonly W = W;
  protected readonly H = H;
  protected readonly PAD = PAD;
  protected readonly ink = CHART_INK;
  protected readonly hoverX = signal<number | null>(null);

  private readonly bounds = computed(() => {
    const all = this.series().flatMap((s) => s.points);
    return {
      xMin: Math.min(...all.map((p) => p.x)),
      xMax: Math.max(...all.map((p) => p.x)),
      yMin: 0,
      yMax: Math.max(...all.map((p) => p.y)) * 1.05,
    };
  });

  private sx(x: number): number {
    const { xMin, xMax } = this.bounds();
    const span = xMax - xMin || 1;
    return PAD.left + ((x - xMin) / span) * (W - PAD.left - PAD.right);
  }

  private sy(y: number): number {
    const { yMin, yMax } = this.bounds();
    const span = yMax - yMin || 1;
    return H - PAD.bottom - ((y - yMin) / span) * (H - PAD.top - PAD.bottom);
  }

  readonly paths = computed(() =>
    this.series().map((s, i) => {
      const d = s.points
        .map((p, idx) => `${idx === 0 ? 'M' : 'L'}${this.sx(p.x).toFixed(1)},${this.sy(p.y).toFixed(1)}`)
        .join(' ');
      const last = s.points[s.points.length - 1];
      const marker = s.marker
        ? {
            cx: this.sx(s.marker.x),
            cy: this.sy(this.interpolate(s, s.marker.x)),
          }
        : null;
      return { name: s.name, d, color: seriesColor(i), endY: this.sy(last.y), marker };
    }),
  );

  readonly yTicks = computed(() => {
    const { yMax } = this.bounds();
    return Array.from({ length: 5 }, (_, i) => {
      const value = (yMax / 4) * i;
      return { value, y: this.sy(value), label: this.formatY()(value) };
    });
  });

  readonly xTicks = computed(() => {
    const { xMin, xMax } = this.bounds();
    return Array.from({ length: 5 }, (_, i) => {
      const value = xMin + ((xMax - xMin) / 4) * i;
      return { value, x: this.sx(value), label: this.formatX()(value) };
    });
  });

  readonly tooltip = computed(() => {
    const hx = this.hoverX();
    if (hx === null) return null;
    const { xMin, xMax } = this.bounds();
    const plotW = W - PAD.left - PAD.right;
    const xValue = xMin + ((hx - PAD.left) / plotW) * (xMax - xMin);
    return {
      x: this.formatX()(xValue),
      leftPct: ((hx / W) * 100),
      rows: this.series().map((s, i) => ({
        name: s.name,
        color: seriesColor(i),
        y: this.formatY()(this.interpolate(s, xValue)),
      })),
    };
  });

  readonly ariaLabel = computed(
    () => `Line chart with ${this.series().length} series: ${this.series().map((s) => s.name).join(', ')}`,
  );

  onMove(event: MouseEvent): void {
    const svg = event.currentTarget as SVGSVGElement;
    const rect = svg.getBoundingClientRect();
    const x = ((event.clientX - rect.left) / rect.width) * W;
    this.hoverX.set(Math.min(Math.max(x, PAD.left), W - PAD.right));
  }

  /** Nearest-neighbour lookup, adequate for the dense curves the API returns. */
  private interpolate(s: LineSeries, x: number): number {
    let best = s.points[0];
    for (const p of s.points) {
      if (Math.abs(p.x - x) < Math.abs(best.x - x)) best = p;
    }
    return best.y;
  }
}
