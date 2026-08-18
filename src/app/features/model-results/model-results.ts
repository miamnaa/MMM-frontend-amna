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
 * "View Model" destination from both the Models list and Results & Insights'
 * per-project model list. Fetches this dataset's real training results
 * (results.mock tells real vs. simulated) and renders them - unlike the
 * Models list's old inline panel, this reuses the shared BarChart/LineChart
 * components for the richer visualization layout.
 */
@Component({
  selector: 'app-model-results',
  imports: [FormsModule, RouterLink, PageHeader, EmptyState, StatTile, BarChart, GroupedBarChart, LineChart],
  templateUrl: './model-results.html',
  styleUrl: './model-results.css',
})
export class ModelResults implements OnInit {
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly datasetService = inject(DatasetService);

  readonly projectId = signal('');
  readonly datasetId = signal('');

  /** Every other real trained model in this project, for the "Select Model" dropdown - lets you switch without going back to the Models list. Starts with just this model so the dropdown isn't empty while the rest are still being checked. */
  readonly modelOptions = signal<{ id: string; name: string }[]>([]);

  readonly dataset = signal<ApiDatasetDetail | null>(null);
  readonly results = signal<TrainingResults | null>(null);
  readonly loading = signal(true);
  readonly notTrained = signal(false);
  readonly loadError = signal<string | null>(null);

  readonly isMockResult = computed(() => this.results()?.mock === true);

  readonly confidenceTiles = computed(() => {
    const c = this.results()?.model_confidence;
    if (!c) return null;
    return {
      accuracy: this.formatPercent(c.overall_accuracy_percent),
      rSquared: typeof c.r_squared === 'number' ? c.r_squared.toFixed(3) : '—',
    };
  });

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
    this.datasetId.set(this.route.snapshot.paramMap.get('datasetId') ?? '');

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

    this.loadModelOptions();
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
