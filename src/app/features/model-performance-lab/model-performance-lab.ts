import { Component, computed, input, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';

import { AdstockDecayCurve, SaturationCurve, TrainingResults } from '../../core/services/dataset.service';
import { seriesColor } from '../../shared/charts/palette';

/**
 * Per Hammad's Model Performance Developer Reference (2026-09-02+): the 4
 * KPI cards read real model_confidence fields the moment they're present -
 * overall_accuracy_percent and r_squared are already confirmed live;
 * average_error_percent and adjusted_r_squared are specified but not yet
 * confirmed on a real response. Each card is independently real or
 * illustrative depending on whether ITS OWN field is present - never a
 * single blanket flag for the whole KPI row, so a real accuracy number
 * doesn't get hidden behind an "illustrative" label just because a
 * different, still-missing field sits next to it.
 *
 * The three charts (decay/saturation/scatter) all need adstock_decay_curves
 * + saturation_curves + data_used together - none of those are part of a
 * confirmed live response yet, so the charts stay illustrative as a group
 * until all three exist, using the same illustrative CHANNELS fallback this
 * page shipped with on 2026-08-28.
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

const FALLBACK_CHANNELS: ChannelSpec[] = [
  { name: 'Google Branded Paid Search', theta: 0.15, gamma: 3, currentSpend: 8.5, lowData: false },
  { name: 'Google Generic Paid Search', theta: 0.2, gamma: 4, currentSpend: 6, lowData: false },
  { name: 'Google Display', theta: 0.4, gamma: 5, currentSpend: 3, lowData: false },
  { name: 'Influencers', theta: 0.55, gamma: 6, currentSpend: 2, lowData: true },
  { name: 'Meta', theta: 0.65, gamma: 4.5, currentSpend: 7, lowData: false },
  { name: 'YouTube', theta: 0.75, gamma: 5, currentSpend: 4, lowData: false },
  { name: 'TV', theta: 0.85, gamma: 7, currentSpend: 3, lowData: false },
];

const FALLBACK_WEEKS_OF_HISTORY = 157;

/** Same real field-name fallback order model-results.ts's channelLabel() uses - the backend's exact channel-name key isn't documented, so every real row is checked against every known alias, first match wins. */
const CHANNEL_NAME_KEYS = ['channel', 'channel_name', 'name', 'variable', 'media_channel'];

function channelNameOf(row: Record<string, unknown>): string | null {
  for (const key of CHANNEL_NAME_KEYS) {
    const value = row[key];
    if (typeof value === 'string' && value.length > 0) return value;
  }
  return null;
}

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
const SAT_PAD = { top: 12, right: 14, bottom: 34, left: 30 };

// ---- Scatter chart geometry ----
const SCATTER_W = 560;
const SCATTER_H = 340;
const SCATTER_PAD = { top: 20, right: 30, bottom: 46, left: 46 };

function fallbackSaturationEffect(spend: number, gamma: number): number {
  return (100 * spend * spend) / (spend * spend + gamma * gamma);
}

interface KpiCard {
  label: string;
  value: string;
  explanation: string;
  real: boolean;
}

interface ScatterPoint {
  name: string;
  x: number;
  y: number;
  lowData: boolean;
}

@Component({
  selector: 'app-model-performance-lab',
  imports: [FormsModule],
  templateUrl: './model-performance-lab.html',
  styleUrl: './model-performance-lab.css',
})
export class ModelPerformanceLab {
  readonly results = input<TrainingResults | null>(null);

  private readonly confidence = computed(() => this.results()?.model_confidence);

  // ---- KPI cards - each independently real or illustrative ----
  readonly kpis = computed<KpiCard[]>(() => {
    const c = this.confidence();
    const accuracy = c?.overall_accuracy_percent;
    const error = c?.average_error_percent;
    const rSquared = c?.r_squared;
    const adjustedRSquared = c?.adjusted_r_squared;

    return [
      {
        label: 'Accuracy',
        value: typeof accuracy === 'number' ? `${Math.round(accuracy * 10) / 10}%` : '89.5%',
        explanation: 'How closely predictions matched what actually happened.',
        real: typeof accuracy === 'number',
      },
      {
        label: 'Typical error',
        value: typeof error === 'number' ? `${Math.round(error * 10) / 10}%` : '10.5%',
        explanation: 'How far off a typical week’s prediction was.',
        real: typeof error === 'number',
      },
      {
        label: 'Pattern explained',
        value: typeof rSquared === 'number' ? `${Math.round(rSquared * 1000) / 10}%` : '68%',
        explanation: 'How much of the ups and downs in results this model accounts for.',
        real: typeof rSquared === 'number',
      },
      {
        label: 'Trust-checked score',
        value: typeof adjustedRSquared === 'number' ? `${Math.round(adjustedRSquared * 1000) / 10}%` : '66%',
        explanation: 'The score above, double-checked so extra inputs can’t inflate it.',
        real: typeof adjustedRSquared === 'number',
      },
    ];
  });

  readonly hasAnyIllustrativeKpi = computed(() => this.kpis().some((k) => !k.real));

  // ---- Real vs illustrative source data for the three charts ----
  /** True only once all three real fields the charts need actually exist together - a partial set (e.g. curves but no data_used) still isn't enough to build every chart honestly, so the whole chart group stays illustrative until all three arrive. */
  readonly hasRealChartData = computed(() => {
    const r = this.results();
    return !!(r?.adstock_decay_curves?.length && r?.saturation_curves?.length && r?.data_used);
  });

  private lowDataChannelNames(): Set<string> {
    const flags = this.results()?.data_quality_flags ?? [];
    const names = new Set<string>();
    flags.forEach((flag) => {
      (flag.columns_involved ?? []).forEach((name) => names.add(name));
    });
    return names;
  }

  private realDecayCurves(): AdstockDecayCurve[] {
    return this.results()?.adstock_decay_curves ?? [];
  }

  private realSaturationCurves(): SaturationCurve[] {
    return this.results()?.saturation_curves ?? [];
  }

  // ---- Decay chart ("How long effects last") ----
  protected readonly decayViewBox = `0 0 ${DECAY_W} ${DECAY_H}`;
  protected readonly decayPad = DECAY_PAD;
  private readonly decayPlotW = DECAY_W - DECAY_PAD.left - DECAY_PAD.right;
  private readonly decayPlotH = DECAY_H - DECAY_PAD.top - DECAY_PAD.bottom;
  protected readonly decayPlotBottom = DECAY_H - DECAY_PAD.bottom;

  /** Real weeks_since_spend values aren't evenly spaced or round (per Hammad's note) - scaled against the real max week seen across every channel's real curve, not a fixed 0-15 range. */
  private readonly decayMaxWeek = computed(() => {
    if (!this.hasRealChartData()) return DECAY_WEEKS;
    const weeks = this.realDecayCurves().flatMap((c) => c.curve.map((p) => p.weeks_since_spend));
    return weeks.length > 0 ? Math.max(...weeks) : DECAY_WEEKS;
  });

  private decayX(week: number): number {
    return DECAY_PAD.left + (week / this.decayMaxWeek()) * this.decayPlotW;
  }

  private decayY(percent: number): number {
    return DECAY_PAD.top + (1 - percent / 100) * this.decayPlotH;
  }

  readonly decaySeries = computed(() => {
    if (this.hasRealChartData()) {
      return this.realDecayCurves().map((ch, i) => ({
        name: ch.channel,
        color: seriesColor(i),
        points: ch.curve
          .map((p) => `${this.decayX(p.weeks_since_spend).toFixed(1)},${this.decayY(p.effect_remaining_percent).toFixed(1)}`)
          .join(' '),
      }));
    }
    return FALLBACK_CHANNELS.map((ch, i) => {
      const points = Array.from({ length: DECAY_WEEKS + 1 }, (_, week) => {
        const percent = 100 * Math.pow(ch.theta, week);
        return `${this.decayX(week).toFixed(1)},${this.decayY(percent).toFixed(1)}`;
      }).join(' ');
      return { name: ch.name, color: seriesColor(i), points };
    });
  });

  readonly decayYTicks = [0, 25, 50, 75, 100].map((v) => ({ value: v, y: this.decayY(v) }));
  readonly decayXTicks = computed(() => {
    const max = this.decayMaxWeek();
    return [0, 0.25, 0.5, 0.75, 1].map((f) => ({ value: Math.round(f * max), x: this.decayX(f * max) }));
  });

  // ---- Saturation chart ("Room left to grow") ----
  protected readonly satViewBox = `0 0 ${SAT_W} ${SAT_H}`;
  protected readonly satPad = SAT_PAD;
  private readonly satPlotW = SAT_W - SAT_PAD.left - SAT_PAD.right;
  private readonly satPlotH = SAT_H - SAT_PAD.top - SAT_PAD.bottom;
  protected readonly satPlotBottom = SAT_H - SAT_PAD.bottom;

  readonly channelNames = computed(() =>
    this.hasRealChartData() ? this.realDecayCurves().map((c) => c.channel) : FALLBACK_CHANNELS.map((c) => c.name),
  );
  private readonly explicitSelectedChannel = signal<string | null>(null);
  readonly selectedChannel = computed(() => this.explicitSelectedChannel() ?? this.channelNames()[0] ?? '');

  setSelectedChannel(name: string): void {
    this.explicitSelectedChannel.set(name);
  }

  private satX(spend: number, maxSpend: number): number {
    return SAT_PAD.left + (spend / maxSpend) * this.satPlotW;
  }

  private satY(effect: number, maxEffect: number): number {
    return SAT_PAD.top + (1 - effect / maxEffect) * this.satPlotH;
  }

  /** The real max spend_level on the selected channel's real curve, or the fixed illustrative 0-10 scale for the fallback - shared between the plotted path and its x-axis ticks so both agree on the same domain. */
  readonly satMaxSpend = computed(() => {
    if (this.hasRealChartData()) {
      const curve = this.realSaturationCurves().find((c) => c.channel === this.selectedChannel())?.curve ?? [];
      return curve.length > 0 ? Math.max(...curve.map((p) => p.spend_level), 1) : SATURATION_MAX_SPEND;
    }
    return SATURATION_MAX_SPEND;
  });

  readonly saturationPath = computed(() => {
    const selected = this.selectedChannel();
    const maxSpend = this.satMaxSpend();

    if (this.hasRealChartData()) {
      const curve = this.realSaturationCurves().find((c) => c.channel === selected)?.curve ?? [];
      if (curve.length === 0) return '';
      const maxEffect = Math.max(...curve.map((p) => p.effect), 1) * 1.08;
      return curve
        .map((p) => `${this.satX(p.spend_level, maxSpend).toFixed(1)},${this.satY(p.effect, maxEffect).toFixed(1)}`)
        .join(' ');
    }

    const ch = FALLBACK_CHANNELS.find((c) => c.name === selected) ?? FALLBACK_CHANNELS[4];
    const maxEffect = fallbackSaturationEffect(SATURATION_MAX_SPEND, ch.gamma) * 1.08;
    return Array.from({ length: SATURATION_STEPS + 1 }, (_, i) => {
      const spend = (i / SATURATION_STEPS) * SATURATION_MAX_SPEND;
      const effect = fallbackSaturationEffect(spend, ch.gamma);
      return `${this.satX(spend, maxSpend).toFixed(1)},${this.satY(effect, maxEffect).toFixed(1)}`;
    }).join(' ');
  });

  readonly satXTicks = computed(() => {
    const max = this.satMaxSpend();
    return [0, 0.25, 0.5, 0.75, 1].map((f) => ({ value: Math.round(f * max), x: this.satX(f * max, max) }));
  });

  // ---- Scatter chart ("Where each channel sits") ----
  protected readonly scatterViewBox = `0 0 ${SCATTER_W} ${SCATTER_H}`;
  protected readonly scatterPad = SCATTER_PAD;
  private readonly scatterPlotW = SCATTER_W - SCATTER_PAD.left - SCATTER_PAD.right;
  private readonly scatterPlotH = SCATTER_H - SCATTER_PAD.top - SCATTER_PAD.bottom;
  protected readonly scatterPlotBottom = SCATTER_H - SCATTER_PAD.bottom;

  private static fallbackHalfLifeWeeks(theta: number): number {
    for (let week = 0; week <= DECAY_WEEKS; week++) {
      if (100 * Math.pow(theta, week) <= 50) return week;
    }
    return DECAY_WEEKS;
  }

  private static fallbackPctMaxedOut(ch: ChannelSpec): number {
    const atCurrent = fallbackSaturationEffect(ch.currentSpend, ch.gamma);
    const atCeiling = fallbackSaturationEffect(SATURATION_MAX_SPEND, ch.gamma);
    return Math.round((atCurrent / atCeiling) * 100);
  }

  /** Real X: first point in the channel's real decay curve where effect_remaining_percent <= 50, that point's real weeks_since_spend. Real Y: typical weekly spend (channel_contribution.spend / data_used.row_count) located against the channel's real saturation curve, divided by the effect at that curve's last (ceiling) point, x100. Exact calc per Hammad's Developer Reference. */
  private realScatterPoints(): { name: string; weeks: number; pct: number; lowData: boolean }[] {
    const results = this.results();
    const rowCount = results?.data_used?.row_count;
    const contribution = results?.channel_contribution ?? [];
    const lowData = this.lowDataChannelNames();

    return this.realDecayCurves().map((decay) => {
      const halfPoint = decay.curve.find((p) => p.effect_remaining_percent <= 50);
      const weeks = halfPoint?.weeks_since_spend ?? decay.curve[decay.curve.length - 1]?.weeks_since_spend ?? 0;

      const satCurve = this.realSaturationCurves().find((c) => c.channel === decay.channel)?.curve ?? [];
      const channelSpend = contribution.find((row) => channelNameOf(row) === decay.channel)?.spend;
      let pct = 0;
      if (satCurve.length > 0 && typeof channelSpend === 'number' && rowCount) {
        const typicalWeeklySpend = channelSpend / rowCount;
        const nearest = satCurve.reduce((best, p) =>
          Math.abs(p.spend_level - typicalWeeklySpend) < Math.abs(best.spend_level - typicalWeeklySpend) ? p : best,
        );
        const ceilingEffect = satCurve[satCurve.length - 1].effect || 1;
        pct = Math.round((nearest.effect / ceilingEffect) * 100);
      }

      return { name: decay.channel, weeks, pct, lowData: lowData.has(decay.channel) };
    });
  }

  private readonly scatterMaxWeeks = computed(() => {
    if (this.hasRealChartData()) {
      const weeks = this.realScatterPoints().map((p) => p.weeks);
      return weeks.length > 0 ? Math.max(...weeks) + 1 : 1;
    }
    return Math.max(...FALLBACK_CHANNELS.map((c) => ModelPerformanceLab.fallbackHalfLifeWeeks(c.theta))) + 1;
  });

  private scatterX(weeks: number): number {
    return SCATTER_PAD.left + (weeks / this.scatterMaxWeeks()) * this.scatterPlotW;
  }

  private scatterY(pct: number): number {
    return SCATTER_PAD.top + (1 - pct / 100) * this.scatterPlotH;
  }

  readonly scatterPoints = computed<ScatterPoint[]>(() => {
    if (this.hasRealChartData()) {
      return this.realScatterPoints().map((p) => ({
        name: p.name,
        x: this.scatterX(p.weeks),
        y: this.scatterY(p.pct),
        lowData: p.lowData,
      }));
    }
    return FALLBACK_CHANNELS.map((ch) => {
      const weeks = ModelPerformanceLab.fallbackHalfLifeWeeks(ch.theta);
      const pct = ModelPerformanceLab.fallbackPctMaxedOut(ch);
      return { name: ch.name, x: this.scatterX(weeks), y: this.scatterY(pct), lowData: ch.lowData };
    });
  });

  readonly scatterXTicks = computed(() => {
    const max = this.scatterMaxWeeks();
    return Array.from({ length: max + 1 }, (_, w) => ({ value: w, x: this.scatterX(w) }));
  });
  readonly scatterYTicks = [0, 25, 50, 75, 100].map((v) => ({ value: v, y: this.scatterY(v) }));

  /**
   * Real channel names ("Google Generic Paid Search") are far wider than
   * the point spacing a handful of channels naturally cluster into - and
   * real channels often share a similarly close real half-life AND a
   * similarly close real saturation %, so points commonly cluster in a
   * tight column (near-identical x, several close y values), not spread
   * evenly across the chart. A row-packing scheme keyed only off
   * horizontal position doesn't catch that: two labels can land in
   * different "rows" and still collide if those rows sit only a few real
   * pixels apart vertically. This instead does real 2D box placement -
   * each label is tried at increasing vertical offsets from its own point
   * (alternating below/above), and only accepted once its real bounding
   * box doesn't overlap any label already placed, checking every previous
   * label, not just ones assumed to share its row.
   */
  readonly scatterLabels = computed(() => {
    const CHAR_WIDTH = 5.6;
    const TEXT_HEIGHT = 12;
    const OFFSET = 9;
    const STEP = 13;
    const CANDIDATE_OFFSETS = Array.from({ length: 8 }, (_, i) => {
      const tier = Math.ceil((i + 1) / 2);
      return i % 2 === 0 ? tier * STEP + 3.5 : -(tier * STEP) + 3.5;
    });
    CANDIDATE_OFFSETS.unshift(3.5);

    const boxesOverlap = (a: { x0: number; x1: number; y: number }, b: { x0: number; x1: number; y: number }) =>
      Math.abs(a.y - b.y) < TEXT_HEIGHT && a.x0 < b.x1 && b.x0 < a.x1;

    const placed: { x0: number; x1: number; y: number }[] = [];

    return [...this.scatterPoints()]
      .sort((a, b) => a.y - b.y)
      .map((p) => {
        const anchor: 'start' | 'end' = p.x > SCATTER_W - SCATTER_PAD.right - 100 ? 'end' : 'start';
        const width = p.name.length * CHAR_WIDTH + OFFSET;
        const baseX = anchor === 'end' ? p.x - OFFSET - width : p.x + OFFSET;
        const box = { x0: baseX, x1: baseX + width, y: p.y };

        let chosenY = p.y + CANDIDATE_OFFSETS[0];
        for (const dy of CANDIDATE_OFFSETS) {
          const candidate = { ...box, y: p.y + dy };
          if (!placed.some((other) => boxesOverlap(candidate, other))) {
            chosenY = candidate.y;
            break;
          }
          chosenY = candidate.y;
        }

        placed.push({ ...box, y: chosenY });
        return { name: p.name, x: anchor === 'end' ? p.x - OFFSET : p.x + OFFSET, y: chosenY, anchor };
      });
  });

  // ---- Bottom info strip ----
  readonly channelCount = computed(() =>
    this.hasRealChartData() ? this.results()?.data_used?.media_columns.length ?? 0 : FALLBACK_CHANNELS.length,
  );
  readonly weeksOfHistory = computed(() =>
    this.hasRealChartData() ? this.results()?.data_used?.row_count ?? 0 : FALLBACK_WEEKS_OF_HISTORY,
  );
}
