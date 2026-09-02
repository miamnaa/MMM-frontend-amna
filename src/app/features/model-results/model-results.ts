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
import { BarDatum } from '../../shared/charts/bar-chart/bar-chart';
import { GroupedBarChart, GroupedBarDatum } from '../../shared/charts/grouped-bar-chart/grouped-bar-chart';
import { LineChart, LineSeries } from '../../shared/charts/line-chart/line-chart';
import { EmptyState } from '../../shared/ui/empty-state/empty-state';
import { InfoTip } from '../../shared/ui/info-tip/info-tip';
import { PageHeader } from '../../shared/ui/page-header/page-header';
import { StatTile } from '../../shared/ui/stat-tile/stat-tile';
import { backendErrorMessage } from '../../shared/utils/backend-error';
import { compactCurrency, currency } from '../../shared/utils/format';

/** Common field names the real backend might use for a channel's display name - checked in order, first match wins. */
const CHANNEL_NAME_KEYS = ['channel', 'channel_name', 'name', 'variable', 'media_channel'];

interface DisplayEntry {
  label: string;
  value: string;
}

/**
 * Two specific green swatches requested directly - a dark green and a
 * light green - used across the grouped charts on this page (ROI vs
 * marginal ROI, current vs optimized spend) instead of a multi-hue
 * palette, so each chart's two series stay visually distinct. Every other
 * chart in the app keeps the default accessibility-validated categorical
 * palette (shared/charts/palette.ts) unchanged - this override is scoped
 * to just this page's charts via each chart component's optional `colors`
 * input.
 */
const BRAND_DARK_GREEN = '#00994D';
const BRAND_LIGHT_GREEN = '#8FCB92';
const BRAND_GROUPED_COLORS: [string, string] = [BRAND_DARK_GREEN, BRAND_LIGHT_GREEN];
const BRAND_BUDGET_COLORS: [string, string] = [BRAND_LIGHT_GREEN, BRAND_DARK_GREEN];

/** A real categorical set for the Insights tab's contribution stack - one distinguishable color per channel, plus a fixed grey for the "Other factors" remainder segment. */
const DONUT_COLORS = ['#00994D', '#3B82F6', '#F59E0B', '#8FCB92', '#EF4444', '#9CA3AF', '#8B5CF6', '#EC4899'];

/**
 * "View Model" destination from both the Models list and Results & Insights'
 * per-project model list. Fetches this dataset's real training results and
 * renders them across two tabs (2026-09-02 redesign): Model Performance for
 * statistical trust, Insights for money/channel decisions - reusing the
 * shared GroupedBarChart/LineChart components for the richer visualization
 * layout. As of today (Anas, real policy change), the backend never falls
 * back to fake/mock data anymore - results.mock can no longer come back
 * true, so there's nothing left to distinguish real vs. simulated here.
 */
@Component({
  selector: 'app-model-results',
  imports: [DecimalPipe, FormsModule, RouterLink, PageHeader, EmptyState, StatTile, InfoTip, GroupedBarChart, LineChart],
  templateUrl: './model-results.html',
  styleUrl: './model-results.css',
})
export class ModelResults implements OnInit {
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly datasetService = inject(DatasetService);

  readonly projectId = signal('');
  readonly datasetId = signal('');

  /**
   * Two tabs only, per the 2026-09-02 redesign: 'performance' answers "can I
   * trust this model" (statistical fit - accuracy, residuals, no money
   * language); 'insights' answers "what should I do about it" (purely
   * money/channel language - contribution, ROI, budget shift, no stats).
   * Overview and Channel Performance were folded into these two rather than
   * kept as separate tabs.
   */
  readonly activeTab = signal<'performance' | 'insights'>('performance');

  protected readonly brandGroupedColors = BRAND_GROUPED_COLORS;
  protected readonly brandBudgetColors = BRAND_BUDGET_COLORS;
  /** Residual bars: dark green for over-performance (actual > predicted), light green for under-performance - matches the brand green pair used everywhere else on this page instead of the old purple. */
  protected readonly residualPositiveColor = BRAND_DARK_GREEN;
  protected readonly residualNegativeColor = BRAND_LIGHT_GREEN;

  /** Every other real trained model in this project, for the "Select Model" dropdown - lets you switch without going back to the Models list. Starts with just this model so the dropdown isn't empty while the rest are still being checked. */
  readonly modelOptions = signal<{ id: string; name: string }[]>([]);

  readonly dataset = signal<ApiDatasetDetail | null>(null);
  readonly results = signal<TrainingResults | null>(null);
  readonly loading = signal(true);
  readonly notTrained = signal(false);
  readonly loadError = signal<string | null>(null);

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

  /** Real total incremental outcome across every channel - feeds the Insights tab's "Total impact" KPI. */
  readonly totalIncrementalOutcome = computed(() => {
    const rows = this.results()?.channel_contribution ?? [];
    const total = rows.reduce((sum, r) => sum + (typeof r.incremental_outcome === 'number' ? r.incremental_outcome : 0), 0);
    return total > 0 ? total : null;
  });

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
  /** Compact ("$2.9M", "$264K") rather than full currency for the bar-top value labels specifically - these sit right above a ~20px-wide bar, and a full "$2,863,000" string is always going to spill well past that no matter the font size. */
  readonly budgetGroupedBars = computed<GroupedBarDatum[]>(() =>
    this.detectGroupedBars(
      this.budgetRows(),
      ['current_spend', 'currentspend'],
      ['optimized_spend', 'optimizedspend'],
      compactCurrency,
    ),
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

  /**
   * Best performer, top contributor, and lowest ROI - all real, direct
   * lookups over channelMap, same source as the table below. "Most
   * efficient (cost per conversion)" and a per-channel "Saturation status"
   * from the reference this was modeled on are deliberately NOT here -
   * both need real fields (a conversion count, a saturation/stability
   * score) the API doesn't return; nothing here is estimated in their
   * place.
   */
  readonly channelSummary = computed(() => {
    const channels = this.channelMap();
    const withRoi = channels.filter((c): c is typeof c & { roi: number } => c.roi !== undefined);
    const withContribution = channels.filter((c): c is typeof c & { contributionPct: number } => c.contributionPct !== undefined);

    return {
      bestRoi: withRoi.length > 0 ? withRoi.reduce((a, b) => (b.roi > a.roi ? b : a)) : null,
      lowestRoi: withRoi.length > 1 ? withRoi.reduce((a, b) => (b.roi < a.roi ? b : a)) : null,
      topContribution: withContribution.length > 0 ? withContribution.reduce((a, b) => (b.contributionPct > a.contributionPct ? b : a)) : null,
    };
  });

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

  readonly formatSignedOutcome = (v: number) => (v >= 0 ? '+' : '−') + currency(Math.abs(v));

  /** Real R² and average error, same real model_confidence fields as the KPI tiles - reused here as a plain-language "what does this mean" readout next to the Actual vs predicted chart. */
  readonly modelFitReadout = computed(() => {
    const confidence = this.confidenceTiles();
    const rSquared = confidence.find((t) => t.key.toLowerCase().includes('r_squared') && !t.key.toLowerCase().includes('adjusted'));
    const avgError = confidence.find((t) => t.key.toLowerCase().includes('average_error') && !t.key.toLowerCase().includes('weighted'));
    if (!rSquared && !avgError) return null;
    return { rSquared: rSquared?.value ?? null, avgError: avgError?.value ?? null };
  });

  /**
   * A real signed-bar layout for the residual chart - actual minus
   * predicted, per real date, as vertical bars around a zero baseline
   * instead of a line. Computed here (not left to the shared LineChart,
   * which doesn't draw bars) since this is the one chart on this page that
   * needs a real centered-on-zero column view rather than a line or a
   * paired comparison.
   */
  readonly residualBars = computed(() => {
    const sorted = this.sortedActualVsPredicted();
    if (sorted.length === 0) return null;

    const W = 720;
    const H = 200;
    const PAD = { top: 14, right: 16, bottom: 26, left: 56 };
    const plotW = W - PAD.left - PAD.right;
    const plotH = H - PAD.top - PAD.bottom;
    const midY = PAD.top + plotH / 2;

    const values = sorted.map((p) => p.actual - p.predicted);
    const maxAbs = Math.max(...values.map((v) => Math.abs(v)), 1);
    const n = values.length;
    const barWidth = Math.max(1, Math.min(6, plotW / n - 1));

    const bars = values.map((v, i) => {
      const x = PAD.left + (n === 1 ? plotW / 2 : (i / (n - 1)) * (plotW - barWidth));
      const h = (Math.abs(v) / maxAbs) * (plotH / 2);
      return { x, y: v >= 0 ? midY - h : midY, width: barWidth, height: Math.max(1, h), positive: v >= 0 };
    });

    const yTicks = [maxAbs, 0, -maxAbs].map((v) => ({
      value: v,
      y: midY - (v / maxAbs) * (plotH / 2),
      label: this.formatSignedOutcome(v),
    }));

    const tickCount = Math.min(6, n);
    const xTicks = Array.from({ length: tickCount }, (_, i) => {
      const idx = tickCount === 1 ? 0 : Math.round((i / (tickCount - 1)) * (n - 1));
      return { x: PAD.left + (n === 1 ? plotW / 2 : (idx / (n - 1)) * (plotW - barWidth)) + barWidth / 2, label: this.formatDateAxis(new Date(sorted[idx].date).getTime()) };
    });

    return { W, H, PAD, midY, bars, yTicks, xTicks };
  });

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
   * Real field, added 2026-08-24 - what would have happened with zero
   * marketing vs. what marketing actually added, as a real split rather
   * than two disconnected outcome numbers. Optional - older completed runs
   * won't have it.
   */
  readonly baselineVsMarketing = computed(() => this.results()?.baseline_vs_marketing ?? null);

  /** Plain-English text for the (i) badges next to jargon-heavy section titles - no ROI/marginal ROI left unexplained. */
  protected readonly HINTS = {
    roi: 'Return on investment - for every $1 spent on this channel, how much extra revenue it brought in on average.',
    marginalRoi: 'What the next dollar you spend on this channel would likely bring back - not the average, but what you\'d get right now if you spent a little more.',
  };

  /**
   * Sum of incremental_outcome / sum of spend across every channel that has
   * both - "spend" only exists on budget_recommendation rows
   * (current_spend), so this is null whenever that array is empty (no
   * target_budget was given for this run), same as the budget chart below.
   */
  readonly overallReturn = computed<number | null>(() => {
    const contribution = this.results()?.channel_contribution ?? [];
    const spendByLabel = new Map<string, number>();
    this.budgetRows().forEach((row, i) => {
      const spend = this.numField(row, ['current_spend', 'currentspend']);
      if (spend !== undefined) spendByLabel.set(this.channelLabel(row, i), spend);
    });
    if (spendByLabel.size === 0) return null;

    let totalOutcome = 0;
    let totalSpend = 0;
    contribution.forEach((row, i) => {
      const spend = spendByLabel.get(this.channelLabel(row, i));
      if (spend !== undefined && typeof row.incremental_outcome === 'number') {
        totalOutcome += row.incremental_outcome;
        totalSpend += spend;
      }
    });
    return totalSpend > 0 ? totalOutcome / totalSpend : null;
  });

  /** Same real roi/marginal_roi pairs as roiGroupedBars, sorted highest ROI first - the "ranking" the Insights tab's Channel ROI chart is named for. */
  readonly sortedRoiGroupedBars = computed<GroupedBarDatum[]>(() =>
    [...this.roiGroupedBars()].sort((x, y) => y.a - x.a),
  );

  /**
   * Real field per Hammad's 2026-09-02 handover - channel names pulled out
   * of data_quality_flags via the same best-effort name/reason detection
   * used elsewhere on this page, since the row's exact shape isn't
   * documented yet. A row only counts as a "low spend" flag when some
   * string field on it actually mentions spend, so an unrelated flag type
   * doesn't get mislabeled here.
   */
  readonly lowDataChannelLabels = computed<string[]>(() => {
    const rows = this.results()?.data_quality_flags ?? [];
    const labels = new Set<string>();
    rows.forEach((row, i) => {
      const mentionsLowSpend = Object.values(row).some(
        (v) => typeof v === 'string' && v.toLowerCase().includes('spend') && v.toLowerCase().includes('low'),
      );
      if (mentionsLowSpend) labels.add(this.channelLabel(row, i));
    });
    return Array.from(labels);
  });

  readonly hasLowDataChannels = computed(() => this.lowDataChannelLabels().length > 0);

  /**
   * Real channel_contribution percentages as stacked-bar segments, plus an
   * honest "Other factors" segment for whatever's left up to 100% - channel
   * contributions never sum to 100% on their own (the remainder is
   * baseline/organic effect), so that gap is shown rather than silently
   * dropped. Skipped (empty) when contribution is under 100 by less than a
   * rounding hair, so a real 99.6% doesn't spawn a pointless sliver segment.
   */
  readonly contributionStackSegments = computed(() => {
    const bars = this.contributionBars();
    if (bars.length === 0) return [];
    const total = bars.reduce((sum, b) => sum + b.value, 0);
    const segments = bars.map((b, i) => ({ label: b.label, pct: b.value, display: b.display, color: DONUT_COLORS[i % DONUT_COLORS.length] }));
    const other = 100 - total;
    if (other > 0.5) {
      segments.push({ label: 'Other factors', pct: other, display: this.formatPercent(other), color: '#9ca3af' });
    }
    return segments;
  });

  readonly hasContributionStack = computed(() => this.contributionStackSegments().length > 0);

  /**
   * Top 4 channels by |spend_change_percent|, either direction - the
   * "biggest changes" list under the budget-shift chart. Real
   * spend_change_percent field, same one recommendationFor's Increase/
   * Decrease badge used to read before that table was removed.
   */
  readonly biggestBudgetChanges = computed(() => {
    return this.budgetRows()
      .map((row, i) => {
        const pct = this.numField(row, ['spend_change_percent', 'spendchangepercent']);
        return pct !== undefined ? { label: this.channelLabel(row, i), pct } : null;
      })
      .filter((e): e is { label: string; pct: number } => e !== null)
      .sort((a, b) => Math.abs(b.pct) - Math.abs(a.pct))
      .slice(0, 4);
  });

  readonly formatXSpend = (v: number) => currency(v);
  /** Same currency() formatter, 2 decimal places - for ROI-style ratios (overall return, top channel), where formatXSpend's default 0 digits would round a real "$1.92" down to a meaningless "$2". */
  readonly formatRatio = (v: number) => currency(v, 2);

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
    this.loadError.set(null);
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
      // Real policy as of today (Anas): the backend never silently falls
      // back to fake data anymore - a real 4xx/5xx here means exactly what
      // it says (training isn't done yet, or the engine couldn't be
      // reached), so show the real message instead of always assuming
      // "not trained yet."
      error: (err: unknown) => {
        this.notTrained.set(true);
        this.loadError.set(backendErrorMessage(err, "This model hasn't completed a real training run yet."));
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

  protected formatPercent(value: unknown): string {
    return typeof value === 'number' ? `${Math.round(value * 10) / 10}%` : '—';
  }

  private formatDecimal(value: unknown): string {
    return typeof value === 'number' ? value.toFixed(2) : '—';
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
