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

/** A real categorical set, only for the Marketing Contribution donut - the one chart on this page that genuinely needs several distinguishable colors (one per channel), unlike the others which compare exactly two series. */
const DONUT_COLORS = ['#00994D', '#3B82F6', '#F59E0B', '#8FCB92', '#EF4444', '#9CA3AF', '#8B5CF6', '#EC4899'];

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

  /** 'overview' is the at-a-glance summary (KPIs, key takeaways, contribution donut, recommended impact); 'performance' answers "can I trust this model" (the confidence KPIs); 'insights' answers "what should I do about it" (everything channel-level). */
  readonly activeTab = signal<'overview' | 'performance' | 'insights'>('overview');

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

  /**
   * Same real channel_contribution data as the bar chart above, reshaped
   * into donut segments - real percentages normalized to sum to 100 (in
   * case rounding in the source data leaves them a hair off), each given a
   * real distinguishable color and a running start/end position around the
   * ring, computed once here instead of duplicated in the template.
   */
  readonly donutSegments = computed(() => {
    const bars = this.contributionBars();
    const total = bars.reduce((sum, b) => sum + b.value, 0);
    if (total <= 0) return [];
    let cursor = 0;
    return bars.map((b, i) => {
      const pct = (b.value / total) * 100;
      const start = cursor;
      cursor += pct;
      return { label: b.label, display: b.display, pct, start, end: cursor, color: DONUT_COLORS[i % DONUT_COLORS.length] };
    });
  });

  readonly donutGradient = computed(() => {
    const segments = this.donutSegments();
    if (segments.length === 0) return 'none';
    return `conic-gradient(${segments.map((s) => `${s.color} ${s.start}% ${s.end}%`).join(', ')})`;
  });

  readonly hasDonut = computed(() => this.donutSegments().length > 0);

  /** Real total incremental outcome across every channel - the sum of the same real per-channel numbers the donut's segments are built from. */
  readonly totalIncrementalOutcome = computed(() => {
    const rows = this.results()?.channel_contribution ?? [];
    const total = rows.reduce((sum, r) => sum + (typeof r.incremental_outcome === 'number' ? r.incremental_outcome : 0), 0);
    return total > 0 ? total : null;
  });

  /**
   * A 4-tile snapshot for the Overview card - total/incremental outcome
   * from the real baseline_vs_marketing split, plus this model's own real
   * R² and average error already shown on Model Performance. Each tile
   * only appears when its real source field is present.
   */
  readonly executiveTiles = computed(() => {
    const tiles: { label: string; value: string; caption: string; icon: string }[] = [];

    const bm = this.baselineVsMarketing();
    if (bm) {
      tiles.push({
        label: 'Total outcome',
        value: this.formatXSpend(bm.baseline_outcome + bm.marketing_outcome),
        caption: 'In this period',
        icon: '📦',
      });
      tiles.push({
        label: 'Incremental outcome',
        value: this.formatXSpend(bm.marketing_outcome),
        caption: `${Math.round(bm.marketing_percent)}% of total`,
        icon: '📈',
      });
    }

    const confidence = this.confidenceTiles();
    const rSquared = confidence.find((t) => t.key.toLowerCase().includes('r_squared') && !t.key.toLowerCase().includes('adjusted'));
    if (rSquared) {
      tiles.push({
        label: 'Model accuracy (R²)',
        value: rSquared.value,
        caption: Number(rSquared.value) >= 0.7 ? 'Good fit' : 'Needs review',
        icon: '🎯',
      });
    }
    const avgError = confidence.find((t) => t.key.toLowerCase().includes('average_error') && !t.key.toLowerCase().includes('weighted'));
    if (avgError) tiles.push({ label: 'Average error', value: avgError.value, caption: 'Average error', icon: '🛡️' });

    return tiles;
  });

  readonly hasExecutiveTiles = computed(() => this.executiveTiles().length > 0);

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

  private numField(row: Record<string, unknown>, keys: string[]): number | undefined {
    const key = Object.keys(row).find((k) => keys.includes(k.toLowerCase()));
    const value = key ? row[key] : undefined;
    return typeof value === 'number' ? value : undefined;
  }

  /**
   * A real total-impact figure, not a separate field the backend returns -
   * plain outcome = spend x ROI, summed across every real channel that has
   * both current_spend/current_roi (for "now") and optimized_spend/
   * optimized_roi (for "if you follow the recommendation"). Same real math
   * as the per-channel budget table, just rolled up into one before/after
   * number so the impact of following every recommendation at once is
   * visible without adding them up by hand.
   */
  readonly recommendedImpact = computed(() => {
    let currentTotal = 0;
    let optimizedTotal = 0;
    let sawCurrent = false;
    let sawOptimized = false;

    for (const row of this.budgetRows()) {
      const currentSpend = this.numField(row, ['current_spend', 'currentspend']);
      const currentRoi = this.numField(row, ['current_roi', 'currentroi']);
      if (currentSpend !== undefined && currentRoi !== undefined) {
        currentTotal += currentSpend * currentRoi;
        sawCurrent = true;
      }

      const optimizedSpend = this.numField(row, ['optimized_spend', 'optimizedspend']);
      const optimizedRoi = this.numField(row, ['optimized_roi', 'optimizedroi']);
      if (optimizedSpend !== undefined && optimizedRoi !== undefined) {
        optimizedTotal += optimizedSpend * optimizedRoi;
        sawOptimized = true;
      }
    }

    if (!sawCurrent || !sawOptimized || currentTotal <= 0) return null;
    const liftPercent = ((optimizedTotal - currentTotal) / currentTotal) * 100;
    return { currentTotal, optimizedTotal, liftPercent };
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
  private readonly sortedActualVsPredicted = computed(() => {
    const points = this.results()?.actual_vs_predicted;
    if (!points || points.length === 0) return [];
    return [...points].sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
  });

  readonly actualVsPredictedSeries = computed<LineSeries[]>(() => {
    const sorted = this.sortedActualVsPredicted();
    if (sorted.length === 0) return [];
    return [
      { name: 'Actual', points: sorted.map((p) => ({ x: new Date(p.date).getTime(), y: p.actual })) },
      { name: 'Predicted', points: sorted.map((p) => ({ x: new Date(p.date).getTime(), y: p.predicted })) },
    ];
  });

  readonly hasActualVsPredicted = computed(() => this.actualVsPredictedSeries().length > 0);

  readonly formatDateAxis = (v: number) => new Date(v).toLocaleDateString('en-GB', { day: '2-digit', month: 'short' });

  /** Real, plain arithmetic on the same real actual_vs_predicted points above - actual minus predicted, per date. Not a new field the backend returns, just the same two real numbers subtracted. */
  readonly residualSeries = computed<LineSeries[]>(() => {
    const sorted = this.sortedActualVsPredicted();
    if (sorted.length === 0) return [];
    return [{ name: 'Residual (Actual − Predicted)', points: sorted.map((p) => ({ x: new Date(p.date).getTime(), y: p.actual - p.predicted })) }];
  });

  readonly hasResiduals = computed(() => this.residualSeries().length > 0);

  readonly formatSignedOutcome = (v: number) => (v >= 0 ? '+' : '−') + currency(Math.abs(v));

  /** Same real actual_vs_predicted points, run as a cumulative sum - how far the model's total running estimate has drifted from the real running total, not just point-by-point. */
  readonly cumulativeSeries = computed<LineSeries[]>(() => {
    const sorted = this.sortedActualVsPredicted();
    if (sorted.length === 0) return [];
    let actualSum = 0;
    let predictedSum = 0;
    const actualPoints: { x: number; y: number }[] = [];
    const predictedPoints: { x: number; y: number }[] = [];
    for (const p of sorted) {
      actualSum += p.actual;
      predictedSum += p.predicted;
      const x = new Date(p.date).getTime();
      actualPoints.push({ x, y: actualSum });
      predictedPoints.push({ x, y: predictedSum });
    }
    return [
      { name: 'Cumulative actual', points: actualPoints },
      { name: 'Cumulative predicted', points: predictedPoints },
    ];
  });

  readonly hasCumulative = computed(() => this.cumulativeSeries().length > 0);

  /** Same real reliabilityRows already used for the composite score bars, reshaped into a table row per metric with its own real value and Good/Moderate/Needs review read - plus a real Total outcome row when baseline_vs_marketing is present. */
  readonly performanceSummaryRows = computed(() => {
    const rows = this.reliabilityRows().map((r) => ({ label: r.label, value: r.display, tier: r.tier }));
    const bm = this.baselineVsMarketing();
    if (bm) {
      rows.push({ label: 'Total outcome', value: this.formatXSpend(bm.baseline_outcome + bm.marketing_outcome), tier: 'strong' as const });
    }
    return rows;
  });

  readonly hasPerformanceSummary = computed(() => this.performanceSummaryRows().length > 0);

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
    roi: 'Return on investment - for every $1 spent on this channel, how much extra revenue it brought in on average.',
    marginalRoi: 'What the next dollar you spend on this channel would likely bring back - not the average, but what you\'d get right now if you spent a little more.',
    carryover: 'Ads don\'t stop working the moment they run - some of the effect lingers into following weeks. This shows how quickly that leftover effect fades.',
    saturation: 'Every channel eventually stops paying off as well the more you spend on it. This shows how close a channel already is to that point.',
  };

/** A takeaway line paired with a real reason it exists - icon/tone are just presentation, chosen by what kind of point the line makes (performance/money/action), not a separate field the backend returns. */
  readonly storyline = computed<{ text: string; icon: string; tone: 'brand' | 'info' | 'warn' }[]>(() => {
    const lines: { text: string; icon: string; tone: 'brand' | 'info' | 'warn' }[] = [];

    const contributions = this.contributionBars();
    const outcomes = this.contributionOutcomes();
    if (contributions.length > 0) {
      const top = contributions.reduce((a, b) => (b.value > a.value ? b : a));
      const outcome = outcomes.find((o) => o.label === top.label);
      lines.push({
        text:
          `${top.label} is your best-performing channel right now` +
          (outcome ? `, bringing in ${outcome.value} in extra sales that marketing alone is responsible for.` : '.'),
        icon: '📊',
        tone: 'brand',
      });
    }

    const bm = this.baselineVsMarketing();
    if (bm) {
      lines.push({
        text: `Overall, ${this.formatXSpend(bm.marketing_outcome)} of your results came from marketing - the other ${this.formatXSpend(bm.baseline_outcome)} would likely have happened anyway.`,
        icon: '💰',
        tone: 'info',
      });
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
      lines.push({
        text: `If you moved some budget from ${decrease.label} into ${increase.label}, you'd likely see a better return - ${increase.label} still has room to grow, while ${decrease.label} is already getting less out of every extra dollar.`,
        icon: '🔄',
        tone: 'warn',
      });
    } else if (increase) {
      lines.push({ text: `${increase.label} still has room to grow - spending a bit more there would likely pay off.`, icon: '🔄', tone: 'warn' });
    } else if (decrease) {
      lines.push({
        text: `${decrease.label} is already past the point where extra spend pays off well - consider pulling some budget back.`,
        icon: '🔄',
        tone: 'warn',
      });
    }

    const impact = this.recommendedImpact();
    if (impact) {
      lines.push({
        text: `Reallocating budget as recommended could change your total outcome by ${impact.liftPercent >= 0 ? '+' : ''}${Math.round(impact.liftPercent * 10) / 10}%.`,
        icon: '📐',
        tone: 'brand',
      });
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

  setTab(tab: 'overview' | 'performance' | 'insights'): void {
    this.activeTab.set(tab);
  }

  /** The Budget recommendation section only exists in the DOM once the Insights tab is actually active - switching tabs and scrolling in the same tick would jump at nothing, since Angular hasn't rendered it yet. */
  goToBudgetPlan(): void {
    this.setTab('insights');
    setTimeout(() => document.getElementById('budget-recommendation')?.scrollIntoView({ behavior: 'smooth', block: 'start' }));
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
