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

const VALUE_LABEL_FONT = '600 10px "DM Sans", sans-serif';
const TICK_FONT = '11px "DM Sans", sans-serif';
const ROW_LABEL_FONT = '10.5px "DM Sans", sans-serif';

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
      <span class="legend-item"><span class="swatch" [style.background]="colorA()"></span>{{ aLabel() }}</span>
      <span class="legend-item"><span class="swatch" [style.background]="colorB()"></span>{{ bLabel() }}</span>
    </div>

    @if (vertical()) {
      <svg [attr.viewBox]="'0 0 ' + VW + ' ' + VH" preserveAspectRatio="xMidYMid meet" role="img" [attr.aria-label]="ariaLabel()">
        @for (t of yTicks(); track t.value) {
          <line [attr.x1]="vLeftPad()" [attr.x2]="VW - VPAD.right" [attr.y1]="t.y" [attr.y2]="t.y" class="grid-line" />
          <text [attr.x]="vLeftPad() - 8" [attr.y]="t.y + 3" text-anchor="end" class="tick">{{ t.label }}</text>
        }
        <line [attr.x1]="vLeftPad()" [attr.x2]="vLeftPad()" [attr.y1]="VPAD.top" [attr.y2]="vPlotBottom()" class="axis-line" />
        <line [attr.x1]="vLeftPad()" [attr.x2]="VW - VPAD.right" [attr.y1]="vPlotBottom()" [attr.y2]="vPlotBottom()" class="axis-line" />

        @for (col of columns(); track col.label) {
          <rect [attr.x]="col.aX" [attr.y]="col.aY" [attr.width]="col.barWidth" [attr.height]="col.aH" [attr.fill]="colorA()" rx="2">
            <title>{{ col.label }} — {{ aLabel() }}: {{ col.aDisplay }}</title>
          </rect>
          <rect [attr.x]="col.bX" [attr.y]="col.bY" [attr.width]="col.barWidth" [attr.height]="col.bH" [attr.fill]="colorB()" rx="2">
            <title>{{ col.label }} — {{ bLabel() }}: {{ col.bDisplay }}</title>
          </rect>
        }
        <!-- All value/row labels painted after every bar, in their own pass -
             a short bar's value label sitting close to a taller neighbouring
             bar was getting visually clipped, painted-over by that bar since
             it came later in a single combined per-column loop. -->
        @for (col of columns(); track col.label) {
          <text [attr.x]="col.aLabelX" [attr.y]="col.aLabelY" text-anchor="middle" class="value-label">{{ col.aDisplay }}</text>
          <text [attr.x]="col.bLabelX" [attr.y]="col.bLabelY" text-anchor="middle" class="value-label">{{ col.bDisplay }}</text>
          @for (line of col.labelLines; track $index) {
            <text [attr.x]="col.centerX" [attr.y]="vPlotBottom() + 16 + $index * 12" text-anchor="middle" class="row-label">
              <title>{{ col.label }}</title>{{ line }}
            </text>
          }
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
          <rect [attr.x]="HPAD.left" [attr.y]="row.aY" [attr.width]="row.aW" [attr.height]="barHeight" [attr.fill]="colorA()" rx="2">
            <title>{{ row.label }} — {{ aLabel() }}: {{ row.aDisplay }}</title>
          </rect>
          <text [attr.x]="HPAD.left + row.aW + 6" [attr.y]="row.aY + barHeight - 3" class="value-label">{{ row.aDisplay }}</text>
          <rect [attr.x]="HPAD.left" [attr.y]="row.bY" [attr.width]="row.bW" [attr.height]="barHeight" [attr.fill]="colorB()" rx="2">
            <title>{{ row.label }} — {{ bLabel() }}: {{ row.bDisplay }}</title>
          </rect>
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
      font-size: 10.5px;
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
  /** Optional [colorA, colorB] override - e.g. a brand color pair for a specific page. Falls back to the default categorical palette when not provided, so every other chart using this component is unaffected. */
  readonly colors = input<[string, string] | null>(null);

  protected readonly colorA = computed(() => this.colors()?.[0] ?? seriesColor(0));
  protected readonly colorB = computed(() => this.colors()?.[1] ?? seriesColor(1));

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

  /**
   * A flat percent-of-groupWidth gap worked for short decimal labels
   * ("0.04") but not currency ("$268,700") - real budget numbers are wide
   * enough that two labels of near-equal value collided into unreadable
   * mush regardless of that gap. Measuring each pair's actual label width
   * (via an offscreen canvas, same font as the rendered <text>) and
   * widening the gap only when a pair actually needs it fixes this for any
   * formatter, not just currency, without wasting space on short labels.
   */
  private measureCanvasCtx: CanvasRenderingContext2D | null | undefined;

  private measureTextWidth(text: string, font = VALUE_LABEL_FONT): number {
    if (this.measureCanvasCtx === undefined) {
      this.measureCanvasCtx = typeof document === 'undefined' ? null : document.createElement('canvas').getContext('2d');
    }
    if (!this.measureCanvasCtx) return text.length * 6;
    this.measureCanvasCtx.font = font;
    return this.measureCanvasCtx.measureText(text).width;
  }

  /**
   * Real budget numbers render as full currency ("$1,863,000"), not the
   * default "K" shorthand - the fixed 56px left pad was sized for short
   * tick labels and silently clipped the widest one off the left edge of
   * the viewBox. Measuring every tick label (same font as the rendered
   * <text class="tick">) and widening the pad only when a real label
   * actually needs it fixes this for any tickFormat, not just currency.
   */
  protected readonly vLeftPad = computed(() => {
    const max = this.maxValue();
    const format = this.tickFormat();
    let widest = 0;
    for (let i = 0; i <= V_TICKS; i++) {
      widest = Math.max(widest, this.measureTextWidth(format((max / V_TICKS) * i), TICK_FONT));
    }
    return Math.max(VPAD.left, Math.ceil(widest) + 16);
  });

  /**
   * Long channel names ("Google Branded Paid Search") in a 9-category
   * chart don't fit their ~70px-wide column - left alone, adjacent labels'
   * text visibly ran into each other. Wraps to at most 2 lines, then
   * hard-truncates each line (with an ellipsis + the full name in a
   * <title> tooltip) so no label can ever render wider than its own
   * column - the only way to *guarantee* neighbours can't collide,
   * short of shrinking the font past legibility.
   */
  private fitLine(text: string, maxWidth: number): string {
    if (this.measureTextWidth(text, ROW_LABEL_FONT) <= maxWidth) return text;
    let truncated = text;
    while (truncated.length > 1 && this.measureTextWidth(`${truncated}…`, ROW_LABEL_FONT) > maxWidth) {
      truncated = truncated.slice(0, -1);
    }
    return `${truncated}…`;
  }

  private wrapLabel(label: string, maxWidth: number): string[] {
    if (this.measureTextWidth(label, ROW_LABEL_FONT) <= maxWidth) return [label];

    const words = label.split(' ');
    let line1 = words[0] ?? label;
    let i = 1;
    for (; i < words.length; i++) {
      const candidate = `${line1} ${words[i]}`;
      if (this.measureTextWidth(candidate, ROW_LABEL_FONT) > maxWidth) break;
      line1 = candidate;
    }
    const rest = words.slice(i).join(' ');
    if (!rest) return [line1];
    return [this.fitLine(line1, maxWidth), this.fitLine(rest, maxWidth)];
  }

  readonly columns = computed(() => {
    const items = this.data();
    const leftPad = this.vLeftPad();
    const plotWidth = VW - leftPad - VPAD.right;
    const groupWidth = plotWidth / Math.max(1, items.length);
    const barWidth = Math.min(28, groupWidth * 0.28);
    const labelMaxWidth = Math.max(20, groupWidth - 4);

    const LABEL_PADDING = 4;
    // Still capped so a pair's gap never eats into the neighbouring group's
    // own space - grows for wide labels, shrinks back for short ones.
    const maxGapForGroup = Math.max(4, groupWidth - barWidth * 2 - 4);

    return items.map((d, i) => {
      const groupStart = leftPad + i * groupWidth;
      const aH = Math.max(2, this.scaleY(d.a));
      const bH = Math.max(2, this.scaleY(d.b));

      // One shared gap for every group (sized for the widest pair in the
      // whole chart) made a short pair like TV's ($714K/$928K) spread its
      // two bars far apart just because some other category (Meta) needed
      // the room - the category name then sat centred in the empty middle,
      // looking like it belonged to neither bar. Each group's gap is now
      // sized only for its OWN pair's labels, capped the same way.
      const widthA = this.measureTextWidth(d.aDisplay);
      const widthB = this.measureTextWidth(d.bDisplay);
      const requiredGap = widthA / 2 + widthB / 2 - barWidth + LABEL_PADDING;
      const gap = Math.min(maxGapForGroup, Math.max(6, groupWidth * 0.1, requiredGap));

      const pairWidth = barWidth * 2 + gap;
      const pairStart = groupStart + (groupWidth - pairWidth) / 2;

      // The gap is still capped so it can't eat into a neighbouring group's
      // own space - that cap can leave one specific pair's labels too close
      // together (e.g. two near-equal, near-max-height bars whose full-
      // currency labels are both wide) - when that pair's two labels would
      // still overlap side by side at this group's actual gap, raise the
      // shorter bar's label an extra row so the two stagger diagonally
      // instead of colliding on the same line.
      const stillCollides = widthA / 2 + widthB / 2 + 2 > barWidth + gap;
      const raiseA = stillCollides && aH <= bH;
      const raiseB = stillCollides && bH < aH;
      // A vertical-only stagger left the two labels still touching when
      // the raise (13px) was close to the rendered text's own line height -
      // nudging the raised label further away from the pair's centre too
      // (A left, B right) guarantees real separation in both directions,
      // not just a coin-flip on whether 13px cleared the font metrics.
      const RAISE = 15;
      const OUTSET = 6;

      return {
        ...d,
        barWidth,
        aX: pairStart,
        aH,
        aY: this.vPlotBottom() - aH,
        aLabelX: pairStart + barWidth / 2 - (raiseA ? OUTSET : 0),
        aLabelY: Math.max(10, this.vPlotBottom() - aH - 4 - (raiseA ? RAISE : 0)),
        bX: pairStart + barWidth + gap,
        bH,
        bY: this.vPlotBottom() - bH,
        bLabelX: pairStart + barWidth + gap + barWidth / 2 + (raiseB ? OUTSET : 0),
        bLabelY: Math.max(10, this.vPlotBottom() - bH - 4 - (raiseB ? RAISE : 0)),
        centerX: groupStart + groupWidth / 2,
        labelLines: this.wrapLabel(d.label, labelMaxWidth),
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
