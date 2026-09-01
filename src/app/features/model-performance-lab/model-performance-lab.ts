import { Component, computed, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';

import { seriesColor } from '../../shared/charts/palette';

/**
 * A brand-new, standalone page (per an explicit design brief, 2026-08-28) -
 * deliberately built separate from the real Results & Insights page rather
 * than replacing its existing four tabs. `model_confidence`,
 * `adstock_decay_curves`, `saturation_curves` and `data_quality_flags` are
 * the field names the brief specifies, but the two curve fields and
 * `data_quality_flags` aren't part of the confirmed real API shape yet
 * (only `overall_accuracy_percent`/`r_squared` are) - the brief explicitly
 * calls for realistic illustrative numbers in that case, so every value on
 * this page is illustrative, not fetched. Swap in a real getResults() call
 * once the backend actually returns these shapes.
 */
interface ChannelSpec {
  name: string;
  /** AdStock carryover (theta) - how much of a week's spend still counts the next week. Higher = longer-lasting. */
  theta: number;
  /** Saturation half-point (gamma) - the spend level where returns are already half of their ceiling. Lower = saturates sooner. */
  gamma: number;
  /** Where this channel typically sits on its own 0-10 illustrative spend scale right now. */
  currentSpend: number;
  /** Flagged in `data_quality_flags` for a low-spend/limited-history warning. */
  lowData: boolean;
}

const CHANNELS: ChannelSpec[] = [
  { name: 'Google Branded Paid Search', theta: 0.15, gamma: 3, currentSpend: 8.5, lowData: false },
  { name: 'Google Generic Paid Search', theta: 0.2, gamma: 4, currentSpend: 6, lowData: false },
  { name: 'Google Display', theta: 0.4, gamma: 5, currentSpend: 3, lowData: false },
  { name: 'Influencers', theta: 0.55, gamma: 6, currentSpend: 2, lowData: true },
  { name: 'Meta', theta: 0.65, gamma: 4.5, currentSpend: 7, lowData: false },
  { name: 'YouTube', theta: 0.75, gamma: 5, currentSpend: 4, lowData: false },
  { name: 'TV', theta: 0.85, gamma: 7, currentSpend: 3, lowData: false },
];

const DECAY_WEEKS = 15;
const SATURATION_MAX_SPEND = 10;
const SATURATION_STEPS = 20;

// ---- Decay chart geometry ----
const DECAY_W = 480;
const DECAY_H = 240;
const DECAY_PAD = { top: 12, right: 14, bottom: 34, left: 40 };

// ---- Saturation chart geometry ----
const SAT_W = 480;
const SAT_H = 240;
const SAT_PAD = { top: 12, right: 14, bottom: 34, left: 14 };

// ---- Scatter chart geometry ----
const SCATTER_W = 560;
const SCATTER_H = 340;
const SCATTER_PAD = { top: 20, right: 30, bottom: 46, left: 46 };

function saturationEffect(spend: number, gamma: number): number {
  return (100 * spend * spend) / (spend * spend + gamma * gamma);
}

@Component({
  selector: 'app-model-performance-lab',
  imports: [FormsModule],
  templateUrl: './model-performance-lab.html',
  styleUrl: './model-performance-lab.css',
})
export class ModelPerformanceLab {
  readonly activeTab = signal<'performance' | 'insights'>('performance');
  readonly trainedRangeLabel = 'Trained on data from Jan 2022 to Dec 2024';

  // ---- KPI cards ----
  readonly kpis = [
    {
      label: 'Accuracy',
      value: '89.5%',
      explanation: 'How closely predictions matched what actually happened.',
    },
    {
      label: 'Typical error',
      value: '10.5%',
      explanation: 'How far off a typical week’s prediction was.',
    },
    {
      label: 'Pattern explained',
      value: '68%',
      explanation: 'How much of the ups and downs in results this model accounts for.',
    },
    {
      label: 'Trust-checked score',
      value: '66%',
      explanation: 'The score above, double-checked so extra inputs can’t inflate it.',
    },
  ];

  // ---- Decay chart ("How long effects last") ----
  protected readonly decayViewBox = `0 0 ${DECAY_W} ${DECAY_H}`;
  protected readonly decayPad = DECAY_PAD;
  private readonly decayPlotW = DECAY_W - DECAY_PAD.left - DECAY_PAD.right;
  private readonly decayPlotH = DECAY_H - DECAY_PAD.top - DECAY_PAD.bottom;
  protected readonly decayPlotBottom = DECAY_H - DECAY_PAD.bottom;

  private decayX(week: number): number {
    return DECAY_PAD.left + (week / DECAY_WEEKS) * this.decayPlotW;
  }

  private decayY(percent: number): number {
    return DECAY_PAD.top + (1 - percent / 100) * this.decayPlotH;
  }

  readonly decaySeries = CHANNELS.map((ch, i) => {
    const points = Array.from({ length: DECAY_WEEKS + 1 }, (_, week) => {
      const percent = 100 * Math.pow(ch.theta, week);
      return `${this.decayX(week).toFixed(1)},${this.decayY(percent).toFixed(1)}`;
    }).join(' ');
    return { name: ch.name, color: seriesColor(i), points };
  });

  readonly decayYTicks = [0, 25, 50, 75, 100].map((v) => ({ value: v, y: this.decayY(v) }));
  readonly decayXTicks = [0, 5, 10, 15].map((w) => ({ value: w, x: this.decayX(w) }));

  // ---- Saturation chart ("Room left to grow") ----
  protected readonly satViewBox = `0 0 ${SAT_W} ${SAT_H}`;
  protected readonly satPad = SAT_PAD;
  private readonly satPlotW = SAT_W - SAT_PAD.left - SAT_PAD.right;
  private readonly satPlotH = SAT_H - SAT_PAD.top - SAT_PAD.bottom;
  protected readonly satPlotBottom = SAT_H - SAT_PAD.bottom;

  readonly channelNames = CHANNELS.map((c) => c.name);
  readonly selectedChannel = signal(CHANNELS[4].name); // Meta - a representative mid-saturation channel

  private satX(spend: number): number {
    return SAT_PAD.left + (spend / SATURATION_MAX_SPEND) * this.satPlotW;
  }

  private satY(effect: number, maxEffect: number): number {
    return SAT_PAD.top + (1 - effect / maxEffect) * this.satPlotH;
  }

  readonly saturationPath = computed(() => {
    const ch = CHANNELS.find((c) => c.name === this.selectedChannel()) ?? CHANNELS[4];
    const maxEffect = saturationEffect(SATURATION_MAX_SPEND, ch.gamma) * 1.08; // headroom so the curve doesn't touch the top edge
    const points = Array.from({ length: SATURATION_STEPS + 1 }, (_, i) => {
      const spend = (i / SATURATION_STEPS) * SATURATION_MAX_SPEND;
      const effect = saturationEffect(spend, ch.gamma);
      return `${this.satX(spend).toFixed(1)},${this.satY(effect, maxEffect).toFixed(1)}`;
    }).join(' ');
    return points;
  });

  // ---- Scatter chart ("Where each channel sits") ----
  protected readonly scatterViewBox = `0 0 ${SCATTER_W} ${SCATTER_H}`;
  protected readonly scatterPad = SCATTER_PAD;
  private readonly scatterPlotW = SCATTER_W - SCATTER_PAD.left - SCATTER_PAD.right;
  private readonly scatterPlotH = SCATTER_H - SCATTER_PAD.top - SCATTER_PAD.bottom;
  protected readonly scatterPlotBottom = SCATTER_H - SCATTER_PAD.bottom;

  private static halfLifeWeeks(theta: number): number {
    for (let week = 0; week <= DECAY_WEEKS; week++) {
      if (100 * Math.pow(theta, week) <= 50) return week;
    }
    return DECAY_WEEKS;
  }

  private static pctMaxedOut(ch: ChannelSpec): number {
    const atCurrent = saturationEffect(ch.currentSpend, ch.gamma);
    const atCeiling = saturationEffect(SATURATION_MAX_SPEND, ch.gamma);
    return Math.round((atCurrent / atCeiling) * 100);
  }

  private readonly scatterMaxWeeks = Math.max(...CHANNELS.map((c) => ModelPerformanceLab.halfLifeWeeks(c.theta))) + 1;

  private scatterX(weeks: number): number {
    return SCATTER_PAD.left + (weeks / this.scatterMaxWeeks) * this.scatterPlotW;
  }

  private scatterY(pct: number): number {
    return SCATTER_PAD.top + (1 - pct / 100) * this.scatterPlotH;
  }

  readonly scatterPoints = CHANNELS.map((ch) => {
    const weeks = ModelPerformanceLab.halfLifeWeeks(ch.theta);
    const pct = ModelPerformanceLab.pctMaxedOut(ch);
    return {
      name: ch.name,
      x: this.scatterX(weeks),
      y: this.scatterY(pct),
      lowData: ch.lowData,
    };
  });

  readonly scatterXTicks = Array.from({ length: this.scatterMaxWeeks + 1 }, (_, w) => ({
    value: w,
    x: this.scatterX(w),
  }));
  readonly scatterYTicks = [0, 25, 50, 75, 100].map((v) => ({ value: v, y: this.scatterY(v) }));

  // ---- Bottom info strip ----
  readonly channelCount = CHANNELS.length;
  readonly weeksOfHistory = 157;
}
