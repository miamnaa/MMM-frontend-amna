import { DecimalPipe } from '@angular/common';
import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';

import {
  ApiDatasetDetail,
  DatasetService,
  TrainingResults,
  isFailedTrainingStatus,
  isTerminalTrainingStatus,
} from '../../core/services/dataset.service';
import { computeModelStatus } from '../../core/services/model-status';
import { BarChart, BarDatum } from '../../shared/charts/bar-chart/bar-chart';
import { GroupedBarChart, GroupedBarDatum } from '../../shared/charts/grouped-bar-chart/grouped-bar-chart';
import { LineChart, LineSeries } from '../../shared/charts/line-chart/line-chart';
import { EmptyState } from '../../shared/ui/empty-state/empty-state';
import { InfoTip } from '../../shared/ui/info-tip/info-tip';
import { PageHeader } from '../../shared/ui/page-header/page-header';
import { StatTile } from '../../shared/ui/stat-tile/stat-tile';
import { currency } from '../../shared/utils/format';

/** Common field names the real backend might use for a channel's display name - checked in order, first match wins. */
const CHANNEL_NAME_KEYS = ['channel', 'channel_name', 'name', 'variable', 'media_channel'];

interface DisplayEntry {
  label: string;
  value: string;
}

const CARRYOVER_WEEKS = 15;
const SATURATION_POINTS = 30;
const SATURATION_MAX_SPEND = 100;

/**
 * Two specific green swatches requested directly - a dark green and a
 * light green - used across every chart on this page instead of a
 * multi-hue palette. Single-series charts (channel contribution, the
 * curves) use the dark green as their one solid color; the two grouped
 * charts pair dark + light so their two series stay visually distinct.
 * Every other chart in the app keeps the default accessibility-validated
 * categorical palette (shared/charts/palette.ts) unchanged - this override
 * is scoped to just this page's charts via each chart component's optional
 * `colors` input.
 */
const BRAND_DARK_GREEN = '#00994D';
const BRAND_LIGHT_GREEN = '#8FCB92';
const BRAND_CHART_COLORS = [BRAND_DARK_GREEN];
const BRAND_GROUPED_COLORS: [string, string] = [BRAND_DARK_GREEN, BRAND_LIGHT_GREEN];
const BRAND_BUDGET_COLORS: [string, string] = [BRAND_LIGHT_GREEN, BRAND_DARK_GREEN];

/**
 * "View Model" destination from both the Models list and Results & Insights'
 * per-project model list. Fetches this dataset's real training results
 * (results.mock tells real vs. simulated) and renders them - unlike the
 * Models list's old inline panel, this reuses the shared BarChart/LineChart
 * components for the richer visualization layout.
 */
@Component({
  selector: 'app-model-results',
  imports: [DecimalPipe, FormsModule, RouterLink, PageHeader, EmptyState, StatTile, InfoTip, BarChart, GroupedBarChart, LineChart],
  templateUrl: './model-results.html',
  styleUrl: './model-results.css',
})
export class ModelResults implements OnInit {
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly datasetService = inject(DatasetService);

  readonly projectId = signal('');
  readonly datasetId = signal('');

  /** 'performance' answers "can I trust this model" (the confidence KPIs); 'insights' answers "what should I do about it" (everything channel-level). Mirrors the Performances/Insights split from the Cassandra reference. */
  readonly activeTab = signal<'performance' | 'insights'>('performance');

  protected readonly brandChartColors = BRAND_CHART_COLORS;
  protected readonly brandGroupedColors = BRAND_GROUPED_COLORS;
  protected readonly brandBudgetColors = BRAND_BUDGET_COLORS;

  /** Every other real trained model in this project, for the "Select Model" dropdown - lets you switch without going back to the Models list. Starts with just this model so the dropdown isn't empty while the rest are still being checked. */
  readonly modelOptions = signal<{ id: string; name: string }[]>([]);

  readonly dataset = signal<ApiDatasetDetail | null>(null);
  readonly results = signal<TrainingResults | null>(null);
  readonly loading = signal(true);
  readonly notTrained = signal(false);
  readonly loadError = signal<string | null>(null);

  readonly isMockResult = computed(() => this.results()?.mock === true);

  private static readonly CONFIDENCE_ICONS = ['📈', '📊', '🎯', '📐', '⏱️', '🧮'];

  /**
   * Plain-English explanation per known confidence metric, matched by
   * substring on the real key name so a field like "r_squared" or
   * "adjusted_r_squared" both resolve without a second lookup table -
   * checked in order, first match wins. Falls back to a generic line for
   * any real field the backend adds that isn't one of these yet, so a new
   * metric never shows up with no explanation at all.
   */
  private static readonly METRIC_HINTS: [string, string][] = [
    ['adjusted_r_squared', 'How much of the change in your sales this model can explain, adjusted so adding more channels doesn\'t inflate the score artificially. Closer to 100% is better.'],
    ['r_squared', 'How much of the change in your sales this model can explain overall. Closer to 100% is better.'],
    ['weighted_average_error', 'How far off the model\'s guesses were on average, weighted toward the periods that matter most. Lower is better.'],
    ['average_error', 'How far off the model\'s guesses were from what actually happened, on average. Lower is better.'],
    ['overall_accuracy', 'How often this model\'s predictions were close to what actually happened. Higher is better.'],
  ];

  private tileHint(key: string): string {
    const lower = key.toLowerCase();
    const match = ModelResults.METRIC_HINTS.find(([k]) => lower.includes(k));
    return match ? match[1] : 'A technical measure of how well this model fits your real data.';
  }

  /**
   * Every real NUMERIC key model_confidence actually has, not just the two
   * documented ones (overall_accuracy_percent, r_squared) - if the backend
   * sends more real confidence metrics (e.g. an adjusted R² or an error
   * rate), they show up here automatically instead of being silently
   * dropped. Non-numeric fields are skipped rather than rendered as a
   * "value" - a real response includes overall_accuracy_description, a
   * plain-text explanation of the accuracy metric, not a KPI itself.
   */
  readonly confidenceTiles = computed(() => {
    const c = this.results()?.model_confidence;
    if (!c) return [];
    return Object.entries(c)
      .filter((entry): entry is [string, number] => typeof entry[1] === 'number')
      .map(([key, value], i) => ({
        key,
        label: this.humanizeKey(key),
        value: this.formatConfidenceValue(key, value),
        icon: ModelResults.CONFIDENCE_ICONS[i % ModelResults.CONFIDENCE_ICONS.length],
        hint: this.tileHint(key),
      }));
  });

  /**
   * Same real model_confidence fields as confidenceTiles above, reshaped as
   * a 0-100 bar per metric.
   * a 0-100 bar per metric instead of a plain tile - a *_percent field is
   * already 0-100; anything else (e.g. r_squared, a 0-1 field) is assumed
   * to be on a 0-1 scale, same assumption formatConfidenceValue() already
   * makes to decide how to print it. "Strong/Moderate/Needs review" is a
   * plain threshold read on that number, not a separate metric the backend
   * returns.
   */
  readonly reliabilityRows = computed(() => {
    const c = this.results()?.model_confidence;
    if (!c) return [];
    return Object.entries(c)
      .filter((entry): entry is [string, number] => typeof entry[1] === 'number')
      .map(([key, value]) => {
        const isPercent = key.toLowerCase().includes('percent');
        const barPct = Math.max(0, Math.min(100, isPercent ? value : value * 100));
        return {
          key,
          label: this.humanizeKey(key),
          display: this.formatConfidenceValue(key, value),
          barPct,
          tier: this.reliabilityTier(barPct),
        };
      });
  });

  /** Simple average of the bars above - a plain summary of what's already shown below it, not a separate metric the backend computes. */
  readonly compositeScore = computed(() => {
    const rows = this.reliabilityRows();
    if (rows.length === 0) return null;
    const avg = rows.reduce((sum, r) => sum + r.barPct, 0) / rows.length;
    return { pct: Math.round(avg * 10) / 10, tier: this.reliabilityTier(avg) };
  });

  private reliabilityTier(pct: number): 'strong' | 'moderate' | 'weak' {
    if (pct >= 85) return 'strong';
    if (pct >= 70) return 'moderate';
    return 'weak';
  }

  protected readonly TIER_LABELS: Record<'strong' | 'moderate' | 'weak', string> = {
    strong: 'Strong',
    moderate: 'Moderate',
    weak: 'Needs review',
  };

  private formatConfidenceValue(key: string, value: number): string {
    return key.toLowerCase().includes('percent') ? this.formatPercent(value) : value.toFixed(3);
  }

  readonly contributionBars = computed<BarDatum[]>(() =>
    (this.results()?.channel_contribution ?? []).map((row, i) => ({
      label: this.channelLabel(row, i),
      value: typeof row.pct_of_contribution === 'number' ? row.pct_of_contribution : 0,
      display: this.formatPercent(row.pct_of_contribution),
    })),
  );

  readonly contributionOutcomes = computed<DisplayEntry[]>(() =>
    (this.results()?.channel_contribution ?? []).map((row, i) => ({
      label: this.channelLabel(row, i),
      value: this.formatCurrency(row.incremental_outcome),
    })),
  );

  private readonly efficiencyRows = computed(() => this.results()?.channel_efficiency ?? []);

  /** Best-effort field detection - channel_efficiency's exact field names aren't documented, only "map into an ROI view." Falls back to a flattened list per channel if a real roi + marginal roi pair isn't found. */
  readonly roiGroupedBars = computed<GroupedBarDatum[]>(() =>
    this.detectGroupedBars(this.efficiencyRows(), ['roi'], ['marginal_roi', 'marginalroi']),
  );

  readonly hasEfficiencyChart = computed(() => this.roiGroupedBars().length > 0);

  readonly efficiencyFallback = computed<{ name: string; entries: DisplayEntry[] }[]>(() => {
    if (this.hasEfficiencyChart()) return [];
    return this.efficiencyRows().map((row, i) => ({ name: this.channelLabel(row, i), entries: this.rowMetrics(row) }));
  });

  private readonly budgetRows = computed<Record<string, unknown>[]>(() => {
    const b = this.results()?.budget_recommendation;
    return Array.isArray(b) ? (b as Record<string, unknown>[]) : [];
  });

  /** Real fields confirmed 2026-08-18 from an actual response: channel, current_spend, optimized_spend, current_roi, optimized_roi, spend_change_dollars/percent, current/optimized_pct_of_budget. */
  readonly budgetGroupedBars = computed<GroupedBarDatum[]>(() =>
    this.detectGroupedBars(this.budgetRows(), ['current_spend', 'currentspend'], ['optimized_spend', 'optimizedspend'], currency),
  );

  readonly hasBudgetChart = computed(() => this.budgetGroupedBars().length > 0);

  readonly budgetFallback = computed<DisplayEntry[]>(() => {
    const b = this.results()?.budget_recommendation;
    if (b === undefined || this.hasBudgetChart()) return [];
    return this.flattenForDisplay(b);
  });

  /**
   * One row per channel, joined by label across channel_contribution,
   * channel_efficiency, and budget_recommendation - the three separate
   * real arrays the API returns. A channel only gets the fields whichever
   * of those three actually included it; nothing here is invented for a
   * channel missing a given metric.
   */
  private readonly channelMap = computed(() => {
    const map = new Map<
      string,
      { label: string; contributionPct?: number; roi?: number; currentSpend?: number; spendChangePercent?: number }
    >();
    const entryFor = (label: string) => {
      let entry = map.get(label);
      if (!entry) {
        entry = { label };
        map.set(label, entry);
      }
      return entry;
    };

    (this.results()?.channel_contribution ?? []).forEach((row, i) => {
      const entry = entryFor(this.channelLabel(row, i));
      if (typeof row.pct_of_contribution === 'number') entry.contributionPct = row.pct_of_contribution;
    });

    this.efficiencyRows().forEach((row, i) => {
      const entry = entryFor(this.channelLabel(row, i));
      const roiKey = Object.keys(row).find((k) => k.toLowerCase() === 'roi');
      const roi = roiKey ? row[roiKey] : undefined;
      if (typeof roi === 'number') entry.roi = roi;
    });

    this.budgetRows().forEach((row, i) => {
      const entry = entryFor(this.channelLabel(row, i));
      const spendKey = Object.keys(row).find((k) => ['current_spend', 'currentspend'].includes(k.toLowerCase()));
      const spend = spendKey ? row[spendKey] : undefined;
      if (typeof spend === 'number') entry.currentSpend = spend;

      const changeKey = Object.keys(row).find((k) =>
        ['spend_change_percent', 'spendchangepercent'].includes(k.toLowerCase()),
      );
      const change = changeKey ? row[changeKey] : undefined;
      if (typeof change === 'number') entry.spendChangePercent = change;

      if (entry.roi === undefined) {
        const currentRoiKey = Object.keys(row).find((k) => ['current_roi', 'currentroi'].includes(k.toLowerCase()));
        const currentRoi = currentRoiKey ? row[currentRoiKey] : undefined;
        if (typeof currentRoi === 'number') entry.roi = currentRoi;
      }
    });

    return Array.from(map.values());
  });

  /** Increase/Decrease at +/-5% spend-change - Maintain inside that band, "—" when no budget recommendation covers this channel at all. */
  private recommendationFor(spendChangePercent: number | undefined): string {
    if (spendChangePercent === undefined) return '—';
    if (spendChangePercent >= 5) return 'Increase';
    if (spendChangePercent <= -5) return 'Decrease';
    return 'Maintain';
  }

  readonly scorecardRows = computed(() => {
    const confidence = this.channelConfidenceMap();
    return this.channelMap().map((c) => {
      const range = confidence.get(c.label);
      return {
        label: c.label,
        spend: c.currentSpend !== undefined ? this.formatCurrency(c.currentSpend) : '—',
        contribution: c.contributionPct !== undefined ? this.formatPercent(c.contributionPct) : '—',
        roi: c.roi !== undefined ? c.roi.toFixed(2) : '—',
        roiRange: range ? `likely ${range.low.toFixed(2)}–${range.high.toFixed(2)}` : null,
        recommendation: this.recommendationFor(c.spendChangePercent),
      };
    });
  });

  readonly hasScorecard = computed(() => this.scorecardRows().length > 0);

  /**
   * 3-4 short, auto-written takeaways from data already on this page - the
   * answer someone would otherwise have to read every chart to piece
   * together themselves. Nothing here is a guess: each line only appears
   * when the real field it depends on is present.
   */
  readonly keyInsights = computed<string[]>(() => {
    const insights: string[] = [];

    const contributions = this.contributionBars();
    if (contributions.length > 0) {
      const top = contributions.reduce((a, b) => (b.value > a.value ? b : a));
      insights.push(`${top.label} drives the most revenue, contributing ${top.display} of total incremental outcome.`);
    }

    const channels = this.channelMap();
    const withRoi = channels.filter((c): c is typeof c & { roi: number } => c.roi !== undefined);
    if (withRoi.length > 0) {
      const best = withRoi.reduce((a, b) => (b.roi > a.roi ? b : a));
      insights.push(`${best.label} has the strongest ROI at ${best.roi.toFixed(2)}.`);
    }

    const withChange = channels.filter(
      (c): c is typeof c & { spendChangePercent: number } => c.spendChangePercent !== undefined,
    );
    if (withChange.length > 0) {
      const increase = withChange.filter((c) => c.spendChangePercent > 0).sort((a, b) => b.spendChangePercent - a.spendChangePercent)[0];
      const decrease = withChange.filter((c) => c.spendChangePercent < 0).sort((a, b) => a.spendChangePercent - b.spendChangePercent)[0];
      if (increase) {
        insights.push(`Consider increasing spend on ${increase.label} by ${Math.round(increase.spendChangePercent)}% for a better return.`);
      }
      if (decrease) {
        insights.push(
          `${decrease.label} looks over-invested relative to its return - consider decreasing spend by ${Math.abs(Math.round(decrease.spendChangePercent))}%.`,
        );
      }
    }

    return insights;
  });

  readonly hasKeyInsights = computed(() => this.keyInsights().length > 0);

  /**
   * The headline decision budget_recommendation already implies, said as a
   * sentence instead of left for someone to read out of the table
   * themselves - "move $X from the channel that's over its efficient range
   * to the one with the higher marginal ROI." Only appears when both a real
   * increase- and decrease-recommended channel exist; nothing invented for
   * a channel budget_recommendation doesn't cover.
   */
  readonly budgetHeadline = computed<string | null>(() => {
    const entries = this.budgetRows()
      .map((row, i) => {
        const key = Object.keys(row).find((k) => ['spend_change_dollars', 'spendchangedollars'].includes(k.toLowerCase()));
        const change = key ? row[key] : undefined;
        return typeof change === 'number' ? { label: this.channelLabel(row, i), change } : null;
      })
      .filter((e): e is { label: string; change: number } => e !== null);

    const increase = entries.filter((e) => e.change > 0).sort((a, b) => b.change - a.change)[0];
    const decrease = entries.filter((e) => e.change < 0).sort((a, b) => a.change - b.change)[0];

    if (increase && decrease) {
      const moveAmount = Math.min(Math.abs(decrease.change), increase.change);
      return `Move ${currency(moveAmount)} from ${decrease.label} to ${increase.label} — marginal ROI is higher there.`;
    }
    if (increase) return `Consider increasing spend on ${increase.label} by ${currency(increase.change)} — marginal ROI is higher there.`;
    if (decrease) return `Consider decreasing spend on ${decrease.label} by ${currency(Math.abs(decrease.change))} — it's already past its efficient range.`;
    return null;
  });

  /**
   * Turns roi + marginal_roi into the diminishing-returns story they
   * already support: healthy average ROI but a much lower marginal ROI
   * means more spend on that channel won't help much. Only fires when a
   * real pair is at least this lopsided - not shown for every channel,
   * just the one it's actually true for.
   */
  readonly diminishingReturnsInsight = computed<string | null>(() => {
    const withRatio = this.roiGroupedBars()
      .filter((b) => b.a > 0)
      .map((b) => ({ ...b, ratio: b.b / b.a }));
    if (withRatio.length === 0) return null;

    const worst = withRatio.reduce((min, b) => (b.ratio < min.ratio ? b : min));
    if (worst.ratio >= 0.6) return null;

    return `${worst.label}'s average ROI (${worst.aDisplay}) is healthy, but marginal ROI (${worst.bDisplay}) is much lower — you're already near this channel's ceiling, more spend won't help much.`;
  });

  /**
   * A real pacing story from the same real saved carryover value the decay
   * curve already plots, just said as a sentence instead of left for
   * someone to read off the chart: how many weeks until half of this
   * channel's effect has faded. theta^N = 0.5 solved for N (weeks) - a real
   * derived number from a real saved value, not a guess.
   */
  readonly decayPacingInsight = computed<string | null>(() => {
    const channels = this.dataset()?.channelHyperparameters ?? [];
    const withHalfLife = channels
      .map((ch) => ({ channel: ch.channel, halfLife: Math.log(0.5) / Math.log(ch.carryover) }))
      .filter((c) => Number.isFinite(c.halfLife) && c.halfLife > 0);
    if (withHalfLife.length === 0) return null;

    const fastest = withHalfLife.reduce((min, c) => (c.halfLife < min.halfLife ? c : min));
    const weeks = Math.max(1, Math.round(fastest.halfLife));
    return `Half of what you spend on ${fastest.channel} stops working within ${weeks} week${weeks === 1 ? '' : 's'} — steady spend beats big spikes here.`;
  });

  /**
   * Real endpoint field, added 2026-08-24 - one {date, actual, predicted}
   * point per real date in the dataset, so the model's fit can be charted
   * over time instead of summarized as a single accuracy percent. Optional
   * on the type - older completed runs won't have it.
   */
  readonly actualVsPredictedSeries = computed<LineSeries[]>(() => {
    const points = this.results()?.actual_vs_predicted;
    if (!points || points.length === 0) return [];
    const sorted = [...points].sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
    return [
      { name: 'Actual', points: sorted.map((p) => ({ x: new Date(p.date).getTime(), y: p.actual })) },
      { name: 'Predicted', points: sorted.map((p) => ({ x: new Date(p.date).getTime(), y: p.predicted })) },
    ];
  });

  readonly hasActualVsPredicted = computed(() => this.actualVsPredictedSeries().length > 0);

  readonly formatDateAxis = (v: number) => new Date(v).toLocaleDateString('en-GB', { day: '2-digit', month: 'short' });

  /**
   * Real field, added 2026-08-24 - a real ROI range per channel, not just
   * the single point-estimate channel_efficiency already has. Joined into
   * the scorecard by channel name so "ROI: 2.10 (likely 1.80–2.40)" sits
   * next to the same channel's other real numbers, rather than a separate
   * disconnected table.
   */
  private readonly channelConfidenceMap = computed(() => {
    const map = new Map<string, { low: number; high: number; confidencePercent: number }>();
    for (const row of this.results()?.channel_confidence ?? []) {
      map.set(row.channel, { low: row.roi_low, high: row.roi_high, confidencePercent: row.confidence_percent });
    }
    return map;
  });

  readonly hasChannelConfidence = computed(() => this.channelConfidenceMap().size > 0);

  /**
   * Real field, added 2026-08-24 - what would have happened with zero
   * marketing vs. what marketing actually added, as a real split rather
   * than two disconnected outcome numbers. Optional - older completed runs
   * won't have it.
   */
  readonly baselineVsMarketing = computed(() => this.results()?.baseline_vs_marketing ?? null);

  /** Plain-English text for the (i) badges next to jargon-heavy section titles - no ROI/marginal ROI/carryover/saturation left unexplained. */
  protected readonly HINTS = {
    composite: 'A single score summarizing how well this model fits your real data. Higher and greener is more trustworthy; a low score means take its recommendations with caution.',
    roi: 'Return on investment - for every $1 spent on this channel, how much extra revenue it brought in on average.',
    marginalRoi: 'What the next dollar you spend on this channel would likely bring back - not the average, but what you\'d get right now if you spent a little more.',
    carryover: 'Ads don\'t stop working the moment they run - some of the effect lingers into following weeks. This shows how quickly that leftover effect fades.',
    saturation: 'Every channel eventually stops paying off as well the more you spend on it. This shows how close a channel already is to that point.',
  };

  /**
   * A short, plain-English story of what's actually happening in this
   * model's results - the same real numbers already on this page (top
   * channel, budget move, baseline split), rewritten as sentences a
   * non-technical reader can follow without knowing what "ROI" or
   * "marginal" mean. Each line only appears when the real data behind it
   * exists; nothing here is invented.
   */
  readonly storyline = computed<string[]>(() => {
    const lines: string[] = [];

    const contributions = this.contributionBars();
    const outcomes = this.contributionOutcomes();
    if (contributions.length > 0) {
      const top = contributions.reduce((a, b) => (b.value > a.value ? b : a));
      const outcome = outcomes.find((o) => o.label === top.label);
      lines.push(
        `${top.label} is your best-performing channel right now` +
          (outcome ? `, bringing in ${outcome.value} in extra sales that marketing alone is responsible for.` : '.'),
      );
    }

    const bm = this.baselineVsMarketing();
    if (bm) {
      lines.push(
        `Overall, ${this.formatXSpend(bm.marketing_outcome)} of your results came from marketing - the other ${this.formatXSpend(bm.baseline_outcome)} would likely have happened anyway.`,
      );
    }

    const entries = this.budgetRows()
      .map((row, i) => {
        const key = Object.keys(row).find((k) => ['spend_change_dollars', 'spendchangedollars'].includes(k.toLowerCase()));
        const change = key ? row[key] : undefined;
        return typeof change === 'number' ? { label: this.channelLabel(row, i), change } : null;
      })
      .filter((e): e is { label: string; change: number } => e !== null);
    const increase = entries.filter((e) => e.change > 0).sort((a, b) => b.change - a.change)[0];
    const decrease = entries.filter((e) => e.change < 0).sort((a, b) => a.change - b.change)[0];
    if (increase && decrease) {
      lines.push(
        `If you moved some budget from ${decrease.label} into ${increase.label}, you'd likely see a better return - ${increase.label} still has room to grow, while ${decrease.label} is already getting less out of every extra dollar.`,
      );
    } else if (increase) {
      lines.push(`${increase.label} still has room to grow - spending a bit more there would likely pay off.`);
    } else if (decrease) {
      lines.push(`${decrease.label} is already past the point where extra spend pays off well - consider pulling some budget back.`);
    }

    return lines;
  });

  readonly hasStoryline = computed(() => this.storyline().length > 0);

  /**
   * Illustrative only, same honesty rule as Hyperparameters' own charts -
   * computed from this model's real saved carryover/saturation values, not
   * from a real curve the backend returned (no such endpoint exists).
   */
  readonly carryoverCurves = computed<LineSeries[]>(() =>
    (this.dataset()?.channelHyperparameters ?? []).map((ch) => ({
      name: ch.channel,
      points: Array.from({ length: CARRYOVER_WEEKS }, (_, w) => ({
        x: w + 1,
        y: Math.round(100 * Math.pow(ch.carryover, w) * 10) / 10,
      })),
    })),
  );

  readonly saturationCurves = computed<LineSeries[]>(() =>
    (this.dataset()?.channelHyperparameters ?? []).map((ch) => {
      const halfPoint = SATURATION_MAX_SPEND / 2;
      const gamma = ch.saturation;
      return {
        name: ch.channel,
        points: Array.from({ length: SATURATION_POINTS + 1 }, (_, i) => {
          const spend = (SATURATION_MAX_SPEND / SATURATION_POINTS) * i;
          const y = (100 * Math.pow(spend, gamma)) / (Math.pow(halfPoint, gamma) + Math.pow(spend, gamma) || 1);
          return { x: spend, y: Number.isFinite(y) ? Math.round(y * 10) / 10 : 0 };
        }),
      };
    }),
  );

  readonly hasCurves = computed(() => (this.dataset()?.channelHyperparameters ?? []).length > 0);

  readonly formatX = (v: number) => `${Math.round(v)}`;
  readonly formatXSpend = (v: number) => currency(v);
  readonly formatYPercent = (v: number) => `${Math.round(v)}%`;

  ngOnInit(): void {
    this.projectId.set(this.route.snapshot.paramMap.get('projectId') ?? '');
    this.loadModelOptions();

    // Switching models via the dropdown navigates within this same route
    // (only :datasetId changes) - Angular reuses this component instance
    // rather than re-running ngOnInit, so everything has to react to the
    // route's real paramMap instead of only reading it once here.
    this.route.paramMap.subscribe((params) => {
      this.datasetId.set(params.get('datasetId') ?? '');
      this.loadModel();
    });
  }

  private loadModel(): void {
    this.loading.set(true);
    this.notTrained.set(false);
    this.dataset.set(null);
    this.results.set(null);

    this.datasetService.getDataset(this.datasetId()).subscribe({
      next: (detail) => {
        this.dataset.set(detail);
        this.modelOptions.update((list) =>
          list.some((m) => m.id === this.datasetId())
            ? list
            : [...list, { id: this.datasetId(), name: detail.name }],
        );
      },
      error: () => {},
    });

    this.datasetService.getResults(this.datasetId()).subscribe({
      next: (results) => {
        this.results.set(results);
        this.loading.set(false);
      },
      error: () => {
        // A model that reached "Ready" but was never actually trained gets
        // a real error here, not fake data - that's a normal state to show
        // plainly, not a failure to alarm about.
        this.notTrained.set(true);
        this.loading.set(false);
      },
    });
  }

  /** Real listForProject(), narrowed to models that have actually completed a real training run (checked the same way Results & Insights' list does - "Ready" alone doesn't mean trained). */
  private loadModelOptions(): void {
    this.datasetService.listForProject(this.projectId()).subscribe({
      next: (datasets) => {
        datasets
          .filter((d) => d.id !== this.datasetId() && computeModelStatus(d) === 'ready')
          .forEach((d) => {
            this.datasetService.getTrainingStatus(d.id).subscribe({
              next: (res) => {
                if (isTerminalTrainingStatus(res.status) && !isFailedTrainingStatus(res.status)) {
                  this.modelOptions.update((list) =>
                    [...list, { id: d.id, name: d.name }].sort((a, b) => a.name.localeCompare(b.name)),
                  );
                }
              },
              error: () => {},
            });
          });
      },
      error: () => {},
    });
  }

  setTab(tab: 'performance' | 'insights'): void {
    this.activeTab.set(tab);
  }

  selectModel(id: string): void {
    if (!id || id === this.datasetId()) return;
    this.router.navigate(['/results', this.projectId(), id]);
  }

  private channelLabel(row: Record<string, unknown>, index: number): string {
    for (const key of CHANNEL_NAME_KEYS) {
      const value = row[key];
      if (typeof value === 'string' && value.length > 0) return value;
    }
    return `Channel ${index + 1}`;
  }

  /** Only pairs a row into the chart when BOTH fields are real numbers - a channel missing either metric drops to the fallback list instead of rendering a half-empty bar. */
  private detectGroupedBars(
    rows: Record<string, unknown>[],
    keysA: string[],
    keysB: string[],
    formatter: (v: number) => string = (v) => this.formatDecimal(v),
  ): GroupedBarDatum[] {
    return rows
      .map((row, i) => {
        const keyA = Object.keys(row).find((k) => keysA.includes(k.toLowerCase()));
        const keyB = Object.keys(row).find((k) => keysB.includes(k.toLowerCase()));
        const a = keyA ? row[keyA] : undefined;
        const b = keyB ? row[keyB] : undefined;
        if (typeof a !== 'number' || typeof b !== 'number') return null;
        return { label: this.channelLabel(row, i), a, aDisplay: formatter(a), b, bDisplay: formatter(b) };
      })
      .filter((r): r is GroupedBarDatum => r !== null);
  }

  private formatPercent(value: unknown): string {
    return typeof value === 'number' ? `${Math.round(value * 10) / 10}%` : '—';
  }

  private formatDecimal(value: unknown): string {
    return typeof value === 'number' ? value.toFixed(2) : '—';
  }

  private formatCurrency(value: unknown): string {
    return typeof value === 'number' ? currency(value) : '—';
  }

  private humanizeKey(key: string): string {
    return key.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
  }

  private formatPrimitive(value: unknown): string {
    if (value === null || value === undefined) return '—';
    if (typeof value === 'number') return new Intl.NumberFormat('en-US', { maximumFractionDigits: 2 }).format(value);
    if (typeof value === 'boolean') return value ? 'Yes' : 'No';
    return String(value);
  }

  /** Turns any unknown value (object, array, or primitive) into simple label/value rows - never leaves a raw object to render as "[object Object]". */
  private flattenForDisplay(value: unknown, prefix = ''): DisplayEntry[] {
    if (Array.isArray(value)) {
      return value.flatMap((item, i) => this.flattenForDisplay(item, prefix ? `${prefix} ${i + 1}` : `Item ${i + 1}`));
    }
    if (value !== null && typeof value === 'object') {
      return Object.entries(value as Record<string, unknown>).flatMap(([key, v]) =>
        this.flattenForDisplay(v, prefix ? `${prefix} — ${this.humanizeKey(key)}` : this.humanizeKey(key)),
      );
    }
    return [{ label: prefix || 'Value', value: this.formatPrimitive(value) }];
  }

  private rowMetrics(row: Record<string, unknown>): DisplayEntry[] {
    const withoutName = { ...row };
    for (const key of CHANNEL_NAME_KEYS) delete withoutName[key];
    return this.flattenForDisplay(withoutName);
  }
}
