import { DecimalPipe } from '@angular/common';
import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';

import { DatasetService, HyperparameterChannel } from '../../core/services/dataset.service';
import { TunnelService } from '../../core/services/tunnel.service';
import { backendErrorMessage } from '../../shared/utils/backend-error';
import { PageHeader } from '../../shared/ui/page-header/page-header';
import { TunnelSteps } from '../../shared/ui/tunnel-steps/tunnel-steps';

const CHART_WIDTH = 640;
const CHART_HEIGHT = 220;
// Room for real axis labels - a $ scale + title on the left, dates + a
// title along the bottom.
const CHART_PAD_TOP = 10;
const CHART_PAD_RIGHT = 12;
const CHART_PAD_LEFT = 58;
const CHART_PAD_BOTTOM = 62;
const CHART_Y_TICKS = 5;
const CHART_X_TICKS = 8;
const SERIES_COLORS = ['#e0554f', '#1baf7a', '#3b82f6', '#f59e0b', '#8b5cf6', '#0891b2'];

function toNumber(value: unknown): number {
  const n = typeof value === 'number' ? value : parseFloat(String(value ?? ''));
  return Number.isFinite(n) ? n : 0;
}

/** "8000" -> "8K", "950" -> "950" - matches how the axis labels read in the reference. */
function formatAxisNumber(value: number): string {
  if (value >= 1000) return `${Math.round(value / 100) / 10}K`;
  return String(Math.round(value));
}

/** "2024-01-08" -> "08 Jan 2024" - falls back to the raw string if it isn't a parseable date. */
function formatAxisDate(raw: string): string {
  const d = new Date(raw);
  if (Number.isNaN(d.getTime())) return raw;
  const day = String(d.getDate()).padStart(2, '0');
  const month = d.toLocaleString('en-US', { month: 'short' });
  return `${day} ${month} ${d.getFullYear()}`;
}

/** Standard Pearson correlation coefficient, -1..1. */
function pearson(xs: number[], ys: number[]): number {
  const n = xs.length;
  if (n === 0) return 0;
  const meanX = xs.reduce((s, v) => s + v, 0) / n;
  const meanY = ys.reduce((s, v) => s + v, 0) / n;
  let num = 0;
  let denX = 0;
  let denY = 0;
  for (let i = 0; i < n; i++) {
    const dx = xs[i] - meanX;
    const dy = ys[i] - meanY;
    num += dx * dy;
    denX += dx * dx;
    denY += dy * dy;
  }
  const den = Math.sqrt(denX * denY);
  return den === 0 ? 0 : num / den;
}

interface ChartSeries {
  name: string;
  color: string;
  points: string;
}

interface CorrelationRow {
  a: string;
  b: string;
  pct: number;
}

interface SpendShareBar {
  name: string;
  pct: number;
}

type ExposureMode = 'auto' | 'positive' | 'negative';
type Row = Record<string, unknown>;

/** Real backend: PATCH /datasets/:id/optimize, shipped 2026-08-12. */
@Component({
  selector: 'app-optimize',
  imports: [FormsModule, DecimalPipe, PageHeader, TunnelSteps],
  templateUrl: './optimize.html',
  styleUrl: './optimize.css',
})
export class Optimize implements OnInit {
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly datasetService = inject(DatasetService);
  private readonly tunnelService = inject(TunnelService);

  readonly projectId = signal('');
  readonly datasetId = signal('');

  readonly startDate = signal('');
  readonly endDate = signal('');
  /** True once GET /datasets/:id confirmed a real saved date range exists - guards the auto-fill below from ever overwriting it. */
  private hasSavedDateRange = false;
  readonly dateRangeAutoFilled = signal(false);

  readonly saving = signal(false);
  readonly saveError = signal<string | null>(null);

  readonly infoOpen = signal(false);

  toggleInfo(): void {
    this.infoOpen.update((open) => !open);
  }

  /** Shows/hides the "Custom Timeframe" trend chart below - purely a display toggle, doesn't affect the real Start/End date fields above it. */
  readonly customTimeframeOpen = signal(true);

  toggleCustomTimeframe(): void {
    this.customTimeframeOpen.update((open) => !open);
  }

  /** Shows/hides the whole "Channels review" card - purely a display toggle. */
  readonly channelsReviewOpen = signal(true);

  toggleChannelsReview(): void {
    this.channelsReviewOpen.update((open) => !open);
  }

  /** Shows/hides the whole "Variable selection review" card - purely a display toggle. */
  readonly variableReviewOpen = signal(true);

  toggleVariableReview(): void {
    this.variableReviewOpen.update((open) => !open);
  }

  /** Shows/hides the whole "Exposure metrics" card - purely a display toggle. */
  readonly exposureMetricsOpen = signal(true);

  toggleExposureMetrics(): void {
    this.exposureMetricsOpen.update((open) => !open);
  }

  /** Mirrors the backend's own 400 rule - caught here before round-tripping. */
  readonly rangeInvalid = computed(
    () => this.startDate().length > 0 && this.endDate().length > 0 && this.startDate() >= this.endDate(),
  );

  readonly canSave = computed(
    () => this.startDate().length > 0 && this.endDate().length > 0 && !this.rangeInvalid(),
  );

  // ---- Everything below is real: GET /datasets/:id/rows (real per-row
  // values) drives the chart, correlation table, and spend-share bars.
  // Channel/target/control NAMES still come from Configure's saved mapping.

  private readonly config = computed(() => this.tunnelService.configuration());
  private readonly mediaChannels = computed(() => this.config()?.mediaColumns ?? []);
  readonly controlColumnsList = computed(() => this.config()?.controlColumns ?? []);

  readonly hasMediaChannels = computed(() => this.mediaChannels().length > 0);
  readonly hasControlColumns = computed(() => this.controlColumnsList().length > 0);

  readonly rows = signal<Row[]>([]);
  readonly rowsLoading = signal(false);
  readonly rowsError = signal<string | null>(null);

  private readonly sortedRows = computed(() => {
    const dateCol = this.config()?.dateColumn;
    const list = this.rows();
    if (!dateCol) return list;
    return [...list].sort((a, b) => String(a[dateCol] ?? '').localeCompare(String(b[dateCol] ?? '')));
  });

  /**
   * Channels review: combining two correlated channels into one. Real call
   * to POST /datasets/:id/combine-columns - the returned per-date series is
   * merged into `rows` under the new field name, so the chart, correlation
   * table, and spend-share bars below all pick it up the same way they'd
   * pick up any other real column.
   */
  readonly combinedGroups = signal<{ name: string; members: string[] }[]>([]);
  readonly aggregating = signal(false);
  readonly aggregateError = signal<string | null>(null);

  readonly effectiveChannels = computed<string[]>(() => {
    const memberToGroup = new Map<string, string>();
    for (const g of this.combinedGroups()) for (const m of g.members) memberToGroup.set(m, g.name);
    const seen = new Set<string>();
    const result: string[] = [];
    for (const ch of this.mediaChannels()) {
      const mapped = memberToGroup.get(ch) ?? ch;
      if (!seen.has(mapped)) {
        seen.add(mapped);
        result.push(mapped);
      }
    }
    return result;
  });

  readonly selectedCombineChannels = signal<string[]>([]);
  readonly newFieldName = signal('');
  readonly combineDropdownOpen = signal(false);

  readonly combineDropdownLabel = computed(() => {
    const selected = this.selectedCombineChannels();
    return selected.length > 0 ? selected.join(', ') : 'Choose 2 or more…';
  });

  toggleCombineDropdown(): void {
    this.combineDropdownOpen.update((open) => !open);
  }

  toggleCombineChannel(channel: string): void {
    this.selectedCombineChannels.update((list) =>
      list.includes(channel) ? list.filter((c) => c !== channel) : [...list, channel],
    );
  }

  readonly canAggregate = computed(
    () => this.selectedCombineChannels().length >= 2 && this.newFieldName().trim().length > 0 && !this.aggregating(),
  );

  aggregateChannels(): void {
    if (!this.canAggregate()) return;
    const members = this.selectedCombineChannels();
    const name = this.newFieldName().trim();

    this.aggregating.set(true);
    this.aggregateError.set(null);

    this.datasetService.combineColumns(this.datasetId(), members).subscribe({
      next: ({ dateColumn, series }) => {
        this.aggregating.set(false);
        const valueByDate = new Map(series.map((s) => [s.date, s.value]));
        this.rows.update((rows) =>
          rows.map((r) => ({ ...r, [name]: valueByDate.get(String(r[dateColumn])) ?? 0 })),
        );
        this.combinedGroups.update((groups) => [...groups, { name, members }]);
        this.combineDropdownOpen.set(false);
        this.selectedCombineChannels.set([]);
        this.newFieldName.set('');
      },
      error: (err: unknown) => {
        this.aggregating.set(false);
        this.aggregateError.set(backendErrorMessage(err, 'Could not combine these channels. Try again.'));
      },
    });
  }

  private plotX(index: number, count: number): number {
    const plotWidth = CHART_WIDTH - CHART_PAD_LEFT - CHART_PAD_RIGHT;
    return CHART_PAD_LEFT + (count <= 1 ? 0 : (index / (count - 1)) * plotWidth);
  }

  private plotY(value: number, max: number): number {
    const plotHeight = CHART_HEIGHT - CHART_PAD_TOP - CHART_PAD_BOTTOM;
    return CHART_HEIGHT - CHART_PAD_BOTTOM - (value / max) * plotHeight;
  }

  /** Real max across every plotted series - one shared $ scale, not a per-line 0-100% normalization. */
  private readonly chartMaxValue = computed(() => {
    const target = this.config()?.targetColumn;
    const names = [target, ...this.effectiveChannels()].filter((n): n is string => !!n).slice(0, 6);
    const rows = this.sortedRows();
    const allValues = names.flatMap((name) => rows.map((r) => toNumber(r[name])));
    return Math.max(1, ...allValues);
  });

  private readonly chartNames = computed(() => {
    const target = this.config()?.targetColumn;
    return [target, ...this.effectiveChannels()].filter((n): n is string => !!n).slice(0, 6);
  });

  /** Custom Timeframe: real weekly trend for the target + up to 5 media channels, one shared $ scale. */
  readonly chartSeries = computed<ChartSeries[]>(() => {
    const names = this.chartNames();
    const rows = this.sortedRows();
    if (rows.length === 0) return [];

    const max = this.chartMaxValue();
    return names.map((name, i) => {
      const values = rows.map((r) => toNumber(r[name]));
      const points = values
        .map((v, w) => `${this.plotX(w, rows.length).toFixed(1)},${this.plotY(v, max).toFixed(1)}`)
        .join(' ');
      return { name, color: SERIES_COLORS[i % SERIES_COLORS.length], points };
    });
  });

  readonly chartViewBox = `0 0 ${CHART_WIDTH} ${CHART_HEIGHT}`;
  readonly chartWidth = CHART_WIDTH;
  readonly chartPlotLeft = CHART_PAD_LEFT;
  readonly chartPlotRight = CHART_WIDTH - CHART_PAD_RIGHT;
  readonly chartPlotTop = CHART_PAD_TOP;
  readonly chartPlotBottom = CHART_HEIGHT - CHART_PAD_BOTTOM;

  /** Rotated "Spend ($)" y-axis title, centered along the plot area's left edge. */
  readonly chartYTitleX = 14;
  readonly chartYTitleY = (CHART_PAD_TOP + (CHART_HEIGHT - CHART_PAD_BOTTOM)) / 2;
  readonly chartYTitleTransform = `rotate(-90 14 ${this.chartYTitleY})`;
  /** "Date" x-axis title, below the rotated date tick labels. */
  readonly chartXTitleX = (CHART_PAD_LEFT + (CHART_WIDTH - CHART_PAD_RIGHT)) / 2;
  readonly chartXTitleY = CHART_HEIGHT - 8;

  readonly chartYAxisTicks = computed(() => {
    const max = this.chartMaxValue();
    return Array.from({ length: CHART_Y_TICKS + 1 }, (_, i) => {
      const value = (max / CHART_Y_TICKS) * i;
      return { y: this.plotY(value, max), label: formatAxisNumber(value) };
    });
  });

  readonly chartXAxisTicks = computed(() => {
    const dateCol = this.config()?.dateColumn;
    const rows = this.sortedRows();
    if (!dateCol || rows.length === 0) return [];

    const count = Math.min(CHART_X_TICKS, rows.length);
    return Array.from({ length: count }, (_, i) => {
      const rowIndex = count === 1 ? 0 : Math.round((i / (count - 1)) * (rows.length - 1));
      return { x: this.plotX(rowIndex, rows.length), label: formatAxisDate(String(rows[rowIndex][dateCol] ?? '')) };
    });
  });

  /**
   * One invisible hover column per real row, spanning the full plot height,
   * so hovering anywhere near a date shows that date's real value for every
   * plotted series - not just the ~8 dates that get a visible tick label.
   */
  readonly chartHoverColumns = computed(() => {
    const rows = this.sortedRows();
    if (rows.length === 0) return [];
    const cellWidth = (CHART_WIDTH - CHART_PAD_LEFT - CHART_PAD_RIGHT) / Math.max(1, rows.length - 1 || 1);
    return rows.map((_, i) => ({ index: i, x: this.plotX(i, rows.length), width: Math.max(2, cellWidth) }));
  });

  readonly hoveredChartPoint = signal<{
    xPct: number;
    label: string;
    items: { name: string; color: string; value: number }[];
  } | null>(null);

  showChartTooltip(rowIndex: number): void {
    const rows = this.sortedRows();
    const dateCol = this.config()?.dateColumn;
    const row = rows[rowIndex];
    if (!row) return;

    const names = this.chartNames();
    this.hoveredChartPoint.set({
      xPct: (this.plotX(rowIndex, rows.length) / CHART_WIDTH) * 100,
      label: dateCol ? formatAxisDate(String(row[dateCol] ?? '')) : '',
      items: names.map((name, i) => ({
        name,
        color: SERIES_COLORS[i % SERIES_COLORS.length],
        value: toNumber(row[name]),
      })),
    });
  }

  hideChartTooltip(): void {
    this.hoveredChartPoint.set(null);
  }

  /** Channels Review: real Pearson correlation between every media-channel pair, highest first. */
  private readonly removedPairs = signal<Set<string>>(new Set());

  readonly correlationRows = computed<CorrelationRow[]>(() => {
    const channels = this.effectiveChannels();
    const rows = this.rows();
    const result: CorrelationRow[] = [];
    for (let i = 0; i < channels.length; i++) {
      for (let j = i + 1; j < channels.length; j++) {
        const xs = rows.map((r) => toNumber(r[channels[i]]));
        const ys = rows.map((r) => toNumber(r[channels[j]]));
        result.push({ a: channels[i], b: channels[j], pct: Math.round(Math.abs(pearson(xs, ys)) * 100) });
      }
    }
    return result.sort((r1, r2) => r2.pct - r1.pct).slice(0, 8);
  });

  pairKey(row: CorrelationRow): string {
    return `${row.a}|${row.b}`;
  }

  readonly visibleCorrelationRows = computed(() =>
    this.correlationRows().filter((row) => !this.removedPairs().has(this.pairKey(row))),
  );

  removePair(row: CorrelationRow): void {
    this.removedPairs.update((set) => new Set(set).add(this.pairKey(row)));
  }

  correlationLevel(pct: number): 'high' | 'medium' {
    return pct >= 80 ? 'high' : 'medium';
  }

  readonly selectedPairKey = signal('');

  removeSelectedPair(): void {
    const row = this.visibleCorrelationRows().find((r) => this.pairKey(r) === this.selectedPairKey());
    if (!row) return;
    this.removePair(row);
    this.selectedPairKey.set('');
  }

  /** Variable Selection Review: real share-of-spend per media channel, summed across every row. */
  private readonly removedVariables = signal<Set<string>>(new Set());

  readonly spendShareBars = computed<SpendShareBar[]>(() => {
    const channels = this.effectiveChannels();
    const rows = this.rows();
    const raw = channels.map((name) => ({
      name,
      raw: rows.reduce((sum, r) => sum + toNumber(r[name]), 0),
    }));
    const total = raw.reduce((sum, r) => sum + r.raw, 0) || 1;
    return raw
      .map((r) => ({ name: r.name, pct: Math.round((r.raw / total) * 1000) / 10 }))
      .sort((a, b) => a.pct - b.pct);
  });

  readonly visibleSpendShareBars = computed(() =>
    this.spendShareBars().filter((bar) => !this.removedVariables().has(bar.name)),
  );

  readonly maxSpendSharePct = computed(() =>
    Math.max(1, ...this.visibleSpendShareBars().map((b) => b.pct)),
  );

  removeVariable(name: string): void {
    this.removedVariables.update((set) => new Set(set).add(name));
  }

  readonly selectedVariableToRemove = signal('');

  removeSelectedVariable(): void {
    const name = this.selectedVariableToRemove();
    if (!name) return;
    this.removeVariable(name);
    this.selectedVariableToRemove.set('');
  }

  /** Exposure Metrics: per-control-column impact direction - no backend endpoint for this exists yet, still illustrative. */
  readonly exposureModes = signal<Record<string, ExposureMode>>({});
  readonly exposureToast = signal(false);
  private exposureToastTimer?: ReturnType<typeof setTimeout>;

  exposureMode(col: string): ExposureMode {
    return this.exposureModes()[col] ?? 'auto';
  }

  private flashExposureToast(): void {
    this.exposureToast.set(true);
    clearTimeout(this.exposureToastTimer);
    this.exposureToastTimer = setTimeout(() => this.exposureToast.set(false), 3000);
  }

  setExposureMode(col: string, mode: ExposureMode): void {
    this.exposureModes.update((modes) => ({ ...modes, [col]: mode }));
    this.flashExposureToast();
  }

  setAllExposure(mode: ExposureMode): void {
    const next: Record<string, ExposureMode> = {};
    for (const col of this.controlColumnsList()) next[col] = mode;
    this.exposureModes.set(next);
    this.flashExposureToast();
  }

  ngOnInit(): void {
    this.projectId.set(this.route.snapshot.paramMap.get('projectId') ?? '');
    this.datasetId.set(this.route.snapshot.paramMap.get('datasetId') ?? '');

    // Real endpoint (GET /datasets/:id, confirmed working 2026-08-13) - the
    // fix for leaving this screen and coming back to a blank form even
    // though the date range was already saved. Best-effort: a failure here
    // just leaves the fields blank, same as before this existed.
    this.datasetService.getDataset(this.datasetId()).subscribe({
      next: (detail) => {
        if (detail.dateRange) {
          this.hasSavedDateRange = true;
          this.startDate.set(detail.dateRange.startDate);
          this.endDate.set(detail.dateRange.endDate);
        }
        this.maybeSuggestDateRange();
      },
      error: () => {},
    });

    // Real endpoint - drives the chart/correlation/spend-share sections
    // below. Best-effort: a failure just leaves those sections empty rather
    // than blocking the rest of the page.
    this.rowsLoading.set(true);
    this.datasetService.getRows(this.datasetId()).subscribe({
      next: ({ rows }) => {
        this.rowsLoading.set(false);
        this.rows.set(rows);
      },
      error: (err: unknown) => {
        this.rowsLoading.set(false);
        this.rowsError.set(backendErrorMessage(err, "Couldn't load this dataset's data."));
      },
    });
  }

  /**
   * First-visit convenience only: if this dataset has never had an Optimize
   * date range saved, prefill Start/End with the real min/max date the
   * backend found in the uploaded file (GET /datasets/:id/date-range) -
   * still fully editable. Requires Configuration to already be saved; the
   * 400 that comes back otherwise is expected (this screen is unreachable
   * before Configure anyway) and just leaves the fields blank, same as
   * before this existed. Called only after getDataset() confirms there's no
   * real saved range to protect - never overwrites one.
   */
  private maybeSuggestDateRange(): void {
    if (this.hasSavedDateRange) return;
    this.datasetService.getDateRange(this.datasetId()).subscribe({
      next: ({ minDate, maxDate }) => {
        this.startDate.set(minDate);
        this.endDate.set(maxDate);
        this.dateRangeAutoFilled.set(true);
      },
      error: () => {},
    });
  }

  save(): void {
    if (!this.canSave() || this.saving()) return;

    const body = { startDate: this.startDate(), endDate: this.endDate() };

    this.saving.set(true);
    this.saveError.set(null);

    this.datasetService.saveOptimize(this.datasetId(), body).subscribe({
      next: () => {
        this.saving.set(false);
        this.tunnelService.setOptimize(body);
        // Calibrate and Hyperparameterization are optional from here - this
        // dialog is the fork: customize them for real, or finish with
        // reasonable defaults instead of forcing every model through both.
        this.showFinishModal.set(true);
      },
      error: (err: unknown) => {
        this.saving.set(false);
        this.saveError.set(backendErrorMessage(err, 'Could not save this date range. Try again.'));
      },
    });
  }

  // ---- "Almost done!" fork after Optimize is saved ----

  readonly showFinishModal = signal(false);
  readonly finishing = signal(false);
  readonly finishError = signal<string | null>(null);

  customizeModel(): void {
    this.showFinishModal.set(false);
    this.router.navigate(['/calibrate', this.projectId(), this.datasetId()]);
  }

  /**
   * Skips Calibrate + Hyperparameterization by saving both for real with
   * neutral defaults (50/50 calibration, mid-range carryover/saturation per
   * channel) rather than bypassing their guards - the model ends up in the
   * exact same "Ready" state either way, just without manual input.
   */
  finishSetup(): void {
    if (this.finishing()) return;
    this.finishing.set(true);
    this.finishError.set(null);

    const calibrationBody = { contributionBeliefPercent: 50, confidencePercent: 50 };
    this.datasetService.saveCalibration(this.datasetId(), calibrationBody).subscribe({
      next: () => {
        this.tunnelService.setCalibration(calibrationBody);

        const channels: HyperparameterChannel[] = this.mediaChannels().map((channel) => ({
          channel,
          carryover: 0.5,
          saturation: 1,
        }));

        this.datasetService.saveHyperparameters(this.datasetId(), channels).subscribe({
          next: () => {
            this.finishing.set(false);
            this.showFinishModal.set(false);
            this.router.navigate(['/models', this.projectId()]);
          },
          error: (err: unknown) => {
            this.finishing.set(false);
            this.finishError.set(backendErrorMessage(err, "Couldn't finish setup automatically. Try again, or customize the model instead."));
          },
        });
      },
      error: (err: unknown) => {
        this.finishing.set(false);
        this.finishError.set(backendErrorMessage(err, "Couldn't finish setup automatically. Try again, or customize the model instead."));
      },
    });
  }
}
