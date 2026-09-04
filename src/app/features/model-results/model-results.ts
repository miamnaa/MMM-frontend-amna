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
import { ModelPerformanceLab } from '../model-performance-lab/model-performance-lab';
import { BarChart, BarDatum } from '../../shared/charts/bar-chart/bar-chart';
import { GroupedBarChart, GroupedBarDatum } from '../../shared/charts/grouped-bar-chart/grouped-bar-chart';
import { EmptyState } from '../../shared/ui/empty-state/empty-state';
import { InfoTip } from '../../shared/ui/info-tip/info-tip';
import { PageHeader } from '../../shared/ui/page-header/page-header';
import { StatTile } from '../../shared/ui/stat-tile/stat-tile';
import { backendErrorMessage } from '../../shared/utils/backend-error';
import { currency } from '../../shared/utils/format';

/** Common field names the real backend might use for a channel's display name - checked in order, first match wins. */
const CHANNEL_NAME_KEYS = ['channel', 'channel_name', 'name', 'variable', 'media_channel'];

/** The "Biggest opportunity" headline shifts this fixed percentage of the lowest-return channel's real spend - not a data field, a fixed UI constant. If this ever becomes user-configurable, it belongs as a real input, not something read from results. */
const SHIFT_PCT = 0.05;

/**
 * Two specific green swatches requested directly - a dark green and a
 * light green - used across this page's grouped/ranked charts instead of a
 * multi-hue palette, so each chart's paired bars stay visually distinct.
 * Every other chart in the app keeps the default accessibility-validated
 * categorical palette (shared/charts/palette.ts) unchanged - this override
 * is scoped to just this page's charts via each chart component's optional
 * `colors` input.
 */
const BRAND_DARK_GREEN = '#00994D';
const BRAND_LIGHT_GREEN = '#8FCB92';
const BRAND_GROUPED_COLORS: [string, string] = [BRAND_DARK_GREEN, BRAND_LIGHT_GREEN];
const RANK_GREEN = '#1BAF7A';
const RANK_RED = '#E34948';
const RANK_GRAY = '#C3C2B7';

/**
 * "View Model" destination from both the Models list and Results & Insights'
 * per-project model list. Fetches this dataset's real training results and
 * renders them across two tabs: Model Performance (Hammad's Model
 * Performance Developer Reference - a real KPI row plus decay/saturation/
 * scatter charts, illustrative until adstock_decay_curves/saturation_curves
 * exist) and Business Insights (Hammad's Business Insights Developer
 * Reference v2, 2026-09-04 - money/channel decisions, no statistical
 * language, no budget_recommendation - that moved to a future Budget
 * Planner module). As of the backend's real policy change, train/status/
 * results never fall back to fake/mock data - results.mock can no longer
 * come back true, so there's nothing left to distinguish real vs. simulated
 * for the fields this page actually reads for real.
 */
@Component({
  selector: 'app-model-results',
  imports: [FormsModule, RouterLink, PageHeader, EmptyState, StatTile, InfoTip, BarChart, GroupedBarChart, ModelPerformanceLab],
  templateUrl: './model-results.html',
  styleUrl: './model-results.css',
})
export class ModelResults implements OnInit {
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly datasetService = inject(DatasetService);

  readonly projectId = signal('');
  readonly datasetId = signal('');

  /** Two tabs: 'performance' (Hammad's Model Performance reference - statistical trust) and 'insights' (Hammad's Business Insights reference v2 - money/channel decisions, no stats language). */
  readonly activeTab = signal<'performance' | 'insights'>('performance');

  protected readonly brandGroupedColors = BRAND_GROUPED_COLORS;

  /** Every other real trained model in this project, for the "Select Model" dropdown - lets you switch without going back to the Models list. Starts with just this model so the dropdown isn't empty while the rest are still being checked. */
  readonly modelOptions = signal<{ id: string; name: string }[]>([]);

  readonly dataset = signal<ApiDatasetDetail | null>(null);
  readonly results = signal<TrainingResults | null>(null);
  readonly loading = signal(true);
  readonly notTrained = signal(false);
  readonly loadError = signal<string | null>(null);

  /** Plain-English text for the (i) badges next to jargon-heavy section titles. */
  protected readonly HINTS = {
    roi: 'Return on investment - for every $1 spent on this channel, how much extra revenue it brought in on average.',
    marginalRoi: 'What the next dollar you spend on this channel would likely bring back - not the average, but what you\'d get right now if you spent a little more.',
  };

  private channelLabel(row: Record<string, unknown>, index: number): string {
    for (const key of CHANNEL_NAME_KEYS) {
      const value = row[key];
      if (typeof value === 'string' && value.length > 0) return value;
    }
    return `Channel ${index + 1}`;
  }

  /** Real `columns_involved` per the Business Insights Developer Reference v2 - the list of channel names each data-quality flag actually covers. Falls back to a generic substring search on any string field for "low"+"spend" if that field isn't present on a given row, since the row's full shape still isn't fully documented. */
  private readonly lowSpendChannelNames = computed<Set<string>>(() => {
    const rows = this.results()?.data_quality_flags ?? [];
    const names = new Set<string>();
    rows.forEach((row) => {
      if (row.columns_involved) {
        row.columns_involved.forEach((name) => names.add(name));
        return;
      }
      const mentionsLowSpend = Object.values(row).some(
        (v) => typeof v === 'string' && v.toLowerCase().includes('spend') && v.toLowerCase().includes('low'),
      );
      if (mentionsLowSpend) {
        const label = this.channelLabel(row, 0);
        if (label) names.add(label);
      }
    });
    return names;
  });

  isLowSpendChannel(name: string): boolean {
    return this.lowSpendChannelNames().has(name);
  }

  // ---- "Where the money goes" ----

  private readonly channelContribution = computed(() => this.results()?.channel_contribution ?? []);

  readonly totalSpend = computed<number | null>(() => {
    const rows = this.channelContribution();
    const withSpend = rows.filter((r) => typeof r.spend === 'number');
    if (withSpend.length === 0) return null;
    return withSpend.reduce((sum, r) => sum + (r.spend as number), 0);
  });

  readonly channelsAnalyzedCount = computed<number | null>(() => {
    const count = this.channelContribution().length || this.results()?.data_used?.media_columns.length || 0;
    return count > 0 ? count : null;
  });

  readonly spendByChannelBars = computed<BarDatum[]>(() =>
    [...this.channelContribution()]
      .filter((r) => typeof r.pct_of_spend === 'number')
      .sort((a, b) => (b.pct_of_spend as number) - (a.pct_of_spend as number))
      .map((row, i) => ({
        label: this.channelLabel(row, i),
        value: row.pct_of_spend as number,
        display: `${Math.round((row.pct_of_spend as number) * 10) / 10}%`,
      })),
  );

  readonly hasSpendByChannel = computed(() => this.spendByChannelBars().length > 0);

  // ---- "What it's getting you" ----

  /** Real total incremental outcome across every channel - feeds the "Total impact" KPI. */
  readonly totalIncrementalOutcome = computed(() => {
    const rows = this.channelContribution();
    const total = rows.reduce((sum, r) => sum + (typeof r.incremental_outcome === 'number' ? r.incremental_outcome : 0), 0);
    return total > 0 ? total : null;
  });

  /**
   * Sum(incremental_outcome) / sum(spend), both now real fields directly on
   * channel_contribution per the Business Insights Developer Reference v2 -
   * no longer needs to cross-reference a separate budget_recommendation
   * array by channel label, which is what the old version of this figure
   * had to do before spend/pct_of_spend existed on this array.
   */
  readonly overallReturn = computed<number | null>(() => {
    const rows = this.channelContribution().filter((r) => typeof r.spend === 'number' && typeof r.incremental_outcome === 'number');
    if (rows.length === 0) return null;
    const totalOutcome = rows.reduce((sum, r) => sum + (r.incremental_outcome as number), 0);
    const totalSpend = rows.reduce((sum, r) => sum + (r.spend as number), 0);
    return totalSpend > 0 ? totalOutcome / totalSpend : null;
  });

  /** Real pct_of_spend vs pct_of_contribution, sorted by the real gap between them, descending - the channels with the biggest mismatch between cost and payoff surface first. */
  readonly spendVsResultBars = computed<GroupedBarDatum[]>(() =>
    [...this.channelContribution()]
      .filter((r) => typeof r.pct_of_spend === 'number' && typeof r.pct_of_contribution === 'number')
      .sort((a, b) => Math.abs((b.pct_of_spend as number) - (b.pct_of_contribution as number)) - Math.abs((a.pct_of_spend as number) - (a.pct_of_contribution as number)))
      .map((row, i) => {
        const spendPct = row.pct_of_spend as number;
        const resultPct = row.pct_of_contribution as number;
        return {
          label: this.channelLabel(row, i),
          a: spendPct,
          aDisplay: `${Math.round(spendPct * 10) / 10}%`,
          b: resultPct,
          bDisplay: `${Math.round(resultPct * 10) / 10}%`,
        };
      }),
  );

  readonly hasSpendVsResult = computed(() => this.spendVsResultBars().length > 0);

  private readonly efficiencyRows = computed(() => this.results()?.channel_efficiency ?? []);

  /** Real roi + marginal_roi per channel, sorted by roi descending - a channel flagged for low spend history gets a warning mark appended directly to its label, same technique the reference mockup itself uses. */
  readonly roiPayoffBars = computed<GroupedBarDatum[]>(() =>
    [...this.efficiencyRows()]
      .map((row, i) => ({ row, index: i, label: this.channelLabel(row, i) }))
      .filter((e) => typeof e.row.roi === 'number' && typeof e.row.marginal_roi === 'number')
      .sort((a, b) => (b.row.roi as number) - (a.row.roi as number))
      .map((e) => {
        const roi = e.row.roi as number;
        const marginal = e.row.marginal_roi as number;
        const label = this.isLowSpendChannel(e.label) ? `${e.label} ⚠` : e.label;
        return { label, a: roi, aDisplay: `${roi.toFixed(2)}x`, b: marginal, bDisplay: `${marginal.toFixed(2)}x` };
      }),
  );

  readonly hasRoiPayoff = computed(() => this.roiPayoffBars().length > 0);

  // ---- "What could change" ----

  /**
   * Highest real marginal_roi minus lowest, among channels NOT flagged for
   * low spend history, x a real shift amount - a fixed 5% of the LOWEST
   * channel's own real spend (from channel_contribution), not an
   * illustrative flat dollar figure. Grounding the shift in that channel's
   * real spend means the headline number is real math on real data, not
   * just a made-up round number applied uniformly regardless of how big or
   * small that channel's real budget actually is. Only the low-spend
   * exclusion applies to this headline card; the ranked chart below
   * includes every channel.
   */
  readonly biggestOpportunity = computed(() => {
    const eligible = this.efficiencyRows()
      .map((row, i) => ({ label: this.channelLabel(row, i), marginal: row.marginal_roi }))
      .filter((e): e is { label: string; marginal: number } => typeof e.marginal === 'number' && !this.isLowSpendChannel(e.label));
    if (eligible.length < 2) return null;

    const highest = eligible.reduce((a, b) => (b.marginal > a.marginal ? b : a));
    const lowest = eligible.reduce((a, b) => (b.marginal < a.marginal ? b : a));
    if (highest.label === lowest.label) return null;

    const lowestSpend = this.channelContribution().find((row, i) => this.channelLabel(row, i) === lowest.label)?.spend;
    if (typeof lowestSpend !== 'number' || lowestSpend <= 0) return null;

    const shiftAmount = lowestSpend * SHIFT_PCT;
    const gapPerDollar = highest.marginal - lowest.marginal;
    const gain = gapPerDollar * shiftAmount;
    return {
      gainDisplay: currency(gain),
      shiftDisplay: currency(shiftAmount),
      shiftPctDisplay: `${Math.round(SHIFT_PCT * 100)}%`,
      fromLabel: lowest.label,
      fromDisplay: currency(lowest.marginal, 2),
      toLabel: highest.label,
      toDisplay: currency(highest.marginal, 2),
    };
  });

  /** Every real channel (no exclusions here, unlike the headline card above), ranked by real marginal_roi - highest colored green, lowest red, everyone else neutral gray. */
  readonly marginalRoiRanked = computed<BarDatum[]>(() =>
    [...this.efficiencyRows()]
      .map((row, i) => ({ label: this.channelLabel(row, i), marginal: row.marginal_roi }))
      .filter((e): e is { label: string; marginal: number } => typeof e.marginal === 'number')
      .sort((a, b) => b.marginal - a.marginal)
      .map((e) => ({ label: e.label, value: e.marginal, display: `${e.marginal.toFixed(2)}x` })),
  );

  readonly hasMarginalRanked = computed(() => this.marginalRoiRanked().length > 0);

  readonly marginalRankedColors = computed(() =>
    this.marginalRoiRanked().map((_, i, arr) => (i === 0 ? RANK_GREEN : i === arr.length - 1 ? RANK_RED : RANK_GRAY)),
  );

  readonly hasAnyInsights = computed(
    () => this.hasSpendByChannel() || this.hasSpendVsResult() || this.hasRoiPayoff() || this.hasMarginalRanked(),
  );

  /** Placeholder click target - the Budget Planner module doesn't exist yet, per the Business Insights Developer Reference v2. Becomes a real routerLink once that module is built. */
  readonly plannerClicked = signal(false);

  openBudgetPlanner(): void {
    this.plannerClicked.set(true);
  }

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
      // Real policy: the backend never silently falls back to fake data
      // anymore - a real 4xx/5xx here means exactly what it says (training
      // isn't done yet, or the engine couldn't be reached), so show the
      // real message instead of always assuming "not trained yet."
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

  readonly formatXSpend = (v: number) => currency(v);
  /** Same currency() formatter, 2 decimal places - for ROI-style ratios, where formatXSpend's default 0 digits would round a real "$1.92" down to a meaningless "$2". */
  readonly formatRatio = (v: number) => currency(v, 2);
}
