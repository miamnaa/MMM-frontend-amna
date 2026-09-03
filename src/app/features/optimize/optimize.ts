import { DecimalPipe } from '@angular/common';
import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { forkJoin } from 'rxjs';

import { AutoCombinedGroup, DatasetService, HyperparameterChannel, SavedColumnMapping } from '../../core/services/dataset.service';
import { SessionService } from '../../core/services/notification.service';
import { TunnelService } from '../../core/services/tunnel.service';
import { backendErrorMessage } from '../../shared/utils/backend-error';
import { PageHeader } from '../../shared/ui/page-header/page-header';
import { WizardTopbar } from '../../shared/ui/wizard-topbar/wizard-topbar';

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

// ---- Channel Health scatter geometry ----
const HEALTH_W = 560;
const HEALTH_H = 300;
const HEALTH_PAD = { top: 20, right: 30, bottom: 46, left: 50 };

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

/**
 * Solves A·x = b via Gaussian elimination with partial pivoting. Returns
 * null for a singular matrix (e.g. two predictor columns that are exact
 * linear combinations of each other) rather than dividing by ~0.
 */
function solveLinearSystem(a: number[][], b: number[]): number[] | null {
  const n = b.length;
  const m = a.map((row, i) => [...row, b[i]]);
  for (let col = 0; col < n; col++) {
    let pivotRow = col;
    for (let r = col + 1; r < n; r++) {
      if (Math.abs(m[r][col]) > Math.abs(m[pivotRow][col])) pivotRow = r;
    }
    [m[col], m[pivotRow]] = [m[pivotRow], m[col]];
    if (Math.abs(m[col][col]) < 1e-9) return null;
    for (let r = 0; r < n; r++) {
      if (r === col) continue;
      const factor = m[r][col] / m[col][col];
      for (let c = col; c <= n; c++) m[r][c] -= factor * m[col][c];
    }
  }
  return m.map((row, i) => row[n] / row[i]);
}

/**
 * R² of a real OLS regression of `y` on every column in `predictors` (each
 * a same-length array), with an intercept - the "how well do the other
 * channels' real spend explain this channel's real spend" figure VIF is
 * built from. Real linear algebra over real per-row values, not an
 * approximation - solved via the normal equations (X'X)β = X'y, which is
 * plenty stable at the handful of media channels this ever runs on.
 */
function multipleRSquared(y: number[], predictors: number[][]): number {
  const n = y.length;
  const k = predictors.length;
  if (n === 0 || k === 0) return 0;

  const p = k + 1;
  const xtx: number[][] = Array.from({ length: p }, () => new Array(p).fill(0));
  const xty: number[] = new Array(p).fill(0);

  for (let r = 0; r < n; r++) {
    const xRow = [1, ...predictors.map((col) => col[r])];
    for (let i = 0; i < p; i++) {
      xty[i] += xRow[i] * y[r];
      for (let j = 0; j < p; j++) xtx[i][j] += xRow[i] * xRow[j];
    }
  }

  const beta = solveLinearSystem(xtx, xty);
  if (!beta) return 0;

  const meanY = y.reduce((s, v) => s + v, 0) / n;
  let ssRes = 0;
  let ssTot = 0;
  for (let r = 0; r < n; r++) {
    const xRow = [1, ...predictors.map((col) => col[r])];
    const predicted = xRow.reduce((s, v, i) => s + v * beta[i], 0);
    ssRes += (y[r] - predicted) ** 2;
    ssTot += (y[r] - meanY) ** 2;
  }
  return ssTot === 0 ? 0 : Math.max(0, 1 - ssRes / ssTot);
}

/** VIF = 1 / (1 - R²). Capped at 20 for display - a real VIF can run into the hundreds for a near-exact linear dependency, which would blow out the chart's scale for one point while every other real channel sits under 5. */
function vifFromRSquared(rSquared: number): number {
  return Math.round(Math.min(1 / (1 - Math.min(rSquared, 0.999)), 20) * 10) / 10;
}

interface ChartSeries {
  name: string;
  color: string;
  points: string;
}

interface SpendShareBar {
  name: string;
  pct: number;
}

interface ChannelHealthPoint {
  name: string;
  spendPct: number;
  vif: number;
  x: number;
  y: number;
  status: 'both' | 'one' | 'healthy';
}

type ExposureMode = 'auto' | 'positive' | 'negative';
type Row = Record<string, unknown>;

/** Real backend: PATCH /datasets/:id/optimize, shipped 2026-08-12. */
@Component({
  selector: 'app-optimize',
  imports: [FormsModule, DecimalPipe, PageHeader, WizardTopbar],
  templateUrl: './optimize.html',
  styleUrl: './optimize.css',
})
export class Optimize implements OnInit {
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly datasetService = inject(DatasetService);
  private readonly tunnelService = inject(TunnelService);
  private readonly session = inject(SessionService);

  /** Real 'read' role can view this screen but the real save/combine-channels endpoints 403 for it - disables Save (and the combine-channels controls). */
  readonly isReadOnly = this.session.isReadOnly;

  readonly projectId = signal('');
  readonly datasetId = signal('');

  readonly startDate = signal('');
  readonly endDate = signal('');
  /** True once GET /datasets/:id confirmed a real saved date range exists - guards the auto-fill below from ever overwriting it. */
  private hasSavedDateRange = false;
  readonly dateRangeAutoFilled = signal(false);
  /** Real earliest/latest date found in the uploaded file - used as the date inputs' min/max so only dates that actually exist in the data can be picked. */
  readonly datasetMinDate = signal('');
  readonly datasetMaxDate = signal('');
  readonly datasetMinDateLabel = computed(() => formatAxisDate(this.datasetMinDate()));
  readonly datasetMaxDateLabel = computed(() => formatAxisDate(this.datasetMaxDate()));

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

  /** Shows/hides the whole "Channel Health" card - purely a display toggle. */
  readonly channelHealthOpen = signal(true);

  toggleChannelHealth(): void {
    this.channelHealthOpen.update((open) => !open);
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

  /**
   * The Custom Timeframe chart's data - sorted by real date, then narrowed
   * to whatever Start/End date is currently selected above it, so changing
   * either field visibly updates the chart instead of always showing every
   * row in the file.
   */
  private readonly sortedRows = computed(() => {
    const dateCol = this.config()?.dateColumn;
    const list = this.rows();
    if (!dateCol) return list;
    const sorted = [...list].sort((a, b) => String(a[dateCol] ?? '').localeCompare(String(b[dateCol] ?? '')));

    const startTime = new Date(this.startDate()).getTime();
    const endTime = new Date(this.endDate()).getTime();
    if (Number.isNaN(startTime) || Number.isNaN(endTime)) return sorted;

    return sorted.filter((row) => {
      const t = new Date(String(row[dateCol] ?? '')).getTime();
      return Number.isNaN(t) ? true : t >= startTime && t <= endTime;
    });
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
  /** True once combineChannels() reports channelHyperparameters was cleared - the old per-channel values no longer match the new combined channel list. */
  readonly hyperparametersNeedRedo = signal(false);

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

/** Pushes a real updated columnMapping into TunnelService so the rest of the tunnel (Hyperparameters' channel list, etc.) reflects the real combined state, not the pre-combine one. */
  private applyRealColumnMapping(mapping: SavedColumnMapping): void {
    const currentConfig = this.tunnelService.configuration();
    if (!currentConfig) return;
    this.tunnelService.setConfiguration({
      ...currentConfig,
      dateColumn: mapping.dateColumn,
      targetColumn: mapping.targetColumn,
      mediaColumns: mapping.mediaColumns,
      controlColumns: mapping.controlColumns,
      organicColumns: mapping.organicColumns,
      geoColumns: mapping.geoColumns,
    });
  }

  /** Merges a real per-date series (from combineColumns' chart-preview call) into `rows` under the given field name, same as any other real column. */
  private mergeSeriesIntoRows(name: string, dateColumn: string, series: { date: string; value: number }[]): void {
    const valueByDate = new Map(series.map((s) => [s.date, s.value]));
    this.rows.update((rows) => rows.map((r) => ({ ...r, [name]: valueByDate.get(String(r[dateColumn])) ?? 0 })));
  }

  /**
   * Runs the chart-preview call (combineColumns, real per-date series for
   * the immediate visual below) and the real config-changing call
   * (combineChannels, updates columnMapping.mediaColumns for what actually
   * trains) together - both have to succeed, since a preview-only success
   * would leave the raw uncombined columns still going to training.
   */
  aggregateChannels(): void {
    if (!this.canAggregate()) return;
    const members = this.selectedCombineChannels();
    const name = this.newFieldName().trim();

    this.aggregating.set(true);
    this.aggregateError.set(null);

    forkJoin({
      preview: this.datasetService.combineColumns(this.datasetId(), members),
      real: this.datasetService.combineChannels(this.datasetId(), members, name),
    }).subscribe({
      next: ({ preview, real }) => {
        this.aggregating.set(false);

        this.mergeSeriesIntoRows(name, preview.dateColumn, preview.series);
        this.combinedGroups.update((groups) => [...groups, { name, members }]);
        this.combineDropdownOpen.set(false);
        this.selectedCombineChannels.set([]);
        this.newFieldName.set('');

        this.applyRealColumnMapping(real.columnMapping);

        if (real.channelHyperparameters === null) {
          this.hyperparametersNeedRedo.set(true);
        }
      },
      error: (err: unknown) => {
        this.aggregating.set(false);
        this.aggregateError.set(backendErrorMessage(err, 'Could not combine these channels. Try again.'));
      },
    });
  }

  readonly autoCombining = signal(false);
  readonly autoCombineError = signal<string | null>(null);
  /** null = never run yet; [] = ran, found nothing to combine; non-empty = ran, these groups got combined. */
  readonly autoCombineGroups = signal<AutoCombinedGroup[] | null>(null);

  /**
   * Finds and combines every real 90%+ correlated channel group in one
   * call - the auto version of the manual picker above, for whichever
   * pairs a person might not have manually noticed in the correlation
   * table (real cause of the paid_social_spend training failure). The
   * manual picker stays exactly as it is; this is an addition, not a
   * replacement, for combining a specific pair the auto version didn't flag.
   */
  autoCombineChannels(): void {
    if (this.autoCombining()) return;

    this.autoCombining.set(true);
    this.autoCombineError.set(null);
    this.autoCombineGroups.set(null);

    this.datasetService.autoCombineChannels(this.datasetId()).subscribe({
      next: ({ dataset, combined }) => {
        this.autoCombineGroups.set(combined);

        if (combined.length === 0) {
          this.autoCombining.set(false);
          return;
        }

        this.applyRealColumnMapping(dataset.columnMapping);
        if (dataset.channelHyperparameters === null) {
          this.hyperparametersNeedRedo.set(true);
        }

        forkJoin(
          combined.map((g) => this.datasetService.combineColumns(this.datasetId(), g.sourceColumns)),
        ).subscribe({
          next: (previews) => {
            this.autoCombining.set(false);
            previews.forEach((preview, i) => {
              const group = combined[i];
              this.mergeSeriesIntoRows(group.newColumnName, preview.dateColumn, preview.series);
              this.combinedGroups.update((gs) => [...gs, { name: group.newColumnName, members: group.sourceColumns }]);
            });
          },
          error: (err: unknown) => {
            this.autoCombining.set(false);
            this.autoCombineError.set(
              backendErrorMessage(err, 'Channels were combined for real, but the chart preview could not be refreshed. Reload to see it.'),
            );
          },
        });
      },
      error: (err: unknown) => {
        this.autoCombining.set(false);
        this.autoCombineError.set(backendErrorMessage(err, "Could not check for correlated channels. Try again."));
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

  /** Channel Health: real share-of-spend per media channel, summed across every row - the scatter's x-axis. */
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

  removeVariable(name: string): void {
    this.removedVariables.update((set) => new Set(set).add(name));
  }

  /**
   * Real per-channel VIF - each channel's real spend regressed on every
   * other real channel's real spend, R² -> VIF - the scatter's y-axis.
   * Needs at least 2 channels and more real rows than channels (a
   * well-posed regression needs more data points than parameters); returns
   * [] otherwise rather than a fabricated number.
   */
  readonly vifRows = computed<{ name: string; vif: number }[]>(() => {
    const channels = this.effectiveChannels();
    const rows = this.rows();
    if (channels.length < 2 || rows.length <= channels.length) return [];
    return channels.map((ch) => {
      const y = rows.map((r) => toNumber(r[ch]));
      const predictors = channels.filter((c) => c !== ch).map((other) => rows.map((r) => toNumber(r[other])));
      return { name: ch, vif: vifFromRSquared(multipleRSquared(y, predictors)) };
    });
  });

  protected readonly maxVif = computed(() => Math.max(5, ...this.vifRows().map((r) => r.vif)));
  protected readonly maxSpendPct = computed(() => Math.max(5, ...this.spendShareBars().map((b) => b.pct)));

  protected readonly healthW = HEALTH_W;
  protected readonly healthH = HEALTH_H;
  protected readonly healthPad = HEALTH_PAD;
  private readonly healthPlotW = HEALTH_W - HEALTH_PAD.left - HEALTH_PAD.right;
  private readonly healthPlotH = HEALTH_H - HEALTH_PAD.top - HEALTH_PAD.bottom;
  protected readonly healthPlotBottom = HEALTH_H - HEALTH_PAD.bottom;

  protected healthX(pct: number): number {
    return HEALTH_PAD.left + (pct / this.maxSpendPct()) * this.healthPlotW;
  }

  protected healthY(vif: number): number {
    return HEALTH_PAD.top + (1 - vif / this.maxVif()) * this.healthPlotH;
  }

  readonly healthXTicks = computed(() => {
    const max = this.maxSpendPct();
    return Array.from({ length: 5 }, (_, i) => {
      const value = Math.round(((max / 4) * i) * 10) / 10;
      return { value, x: this.healthX(value) };
    });
  });

  readonly healthYTicks = computed(() => {
    const max = this.maxVif();
    return Array.from({ length: 5 }, (_, i) => {
      const value = Math.round(((max / 4) * i) * 10) / 10;
      return { value, y: this.healthY(value) };
    });
  });

  /** Real channel points on the scatter - joins the same real spend-share and VIF figures above by channel name, classified against whichever cutoff sliders are currently on. */
  readonly channelHealthPoints = computed<ChannelHealthPoint[]>(() => {
    const vifMap = new Map(this.vifRows().map((r) => [r.name, r.vif]));
    const spendCutoff = this.spendCutoffEnabled() ? this.spendCutoffPct() : -Infinity;
    const vifCutoff = this.vifCutoffEnabled() ? this.vifCutoffValue() : Infinity;
    return this.visibleSpendShareBars()
      .filter((bar) => vifMap.has(bar.name))
      .map((bar) => {
        const vif = vifMap.get(bar.name)!;
        const lowSpend = bar.pct < spendCutoff;
        const highVif = vif > vifCutoff;
        const status: ChannelHealthPoint['status'] = lowSpend && highVif ? 'both' : lowSpend || highVif ? 'one' : 'healthy';
        return { name: bar.name, spendPct: bar.pct, vif, x: this.healthX(bar.pct), y: this.healthY(vif), status };
      });
  });

  readonly hasChannelHealthData = computed(() => this.channelHealthPoints().length > 0);

  /** Points are labeled on hover, not permanently - real channel lists commonly bunch several names into the same low-spend/low-VIF corner, and a permanent label per point overlaps illegibly once more than a handful of channels are close together. */
  readonly hoveredHealthPoint = signal<{ xPct: number; yPct: number; name: string; spendPct: number; vif: number } | null>(null);

  showHealthTooltip(point: ChannelHealthPoint): void {
    this.hoveredHealthPoint.set({
      xPct: (point.x / HEALTH_W) * 100,
      yPct: (point.y / HEALTH_H) * 100,
      name: point.name,
      spendPct: point.spendPct,
      vif: point.vif,
    });
  }

  hideHealthTooltip(): void {
    this.hoveredHealthPoint.set(null);
  }

  readonly spendCutoffEnabled = signal(true);
  readonly spendCutoffPct = signal(3);
  readonly vifCutoffEnabled = signal(true);
  readonly vifCutoffValue = signal(3);

  readonly spendFlaggedChannels = computed(() =>
    this.channelHealthPoints().filter((p) => p.spendPct < this.spendCutoffPct()).map((p) => p.name),
  );
  readonly vifFlaggedChannels = computed(() =>
    this.channelHealthPoints().filter((p) => p.vif > this.vifCutoffValue()).map((p) => p.name),
  );

  readonly selectedHealthChannelName = signal<string | null>(null);

  /** Falls back to the worst-flagged real channel (both issues, then one issue, then just the first) so the action panel isn't empty before anyone's clicked a point. */
  readonly effectiveSelectedHealthChannel = computed(() => {
    const points = this.channelHealthPoints();
    if (points.length === 0) return null;
    const explicit = points.find((p) => p.name === this.selectedHealthChannelName());
    if (explicit) return explicit;
    return points.find((p) => p.status === 'both') ?? points.find((p) => p.status === 'one') ?? points[0];
  });

  selectHealthChannel(name: string): void {
    this.selectedHealthChannelName.set(name);
  }

  /** Real most-correlated other channel (same real Pearson math the old correlation table used), surfaced per-channel as the combine suggestion instead of a standalone pair table. */
  readonly healthChannelSuggestedPartner = computed<string | null>(() => {
    const selected = this.effectiveSelectedHealthChannel();
    const rows = this.rows();
    if (!selected || rows.length === 0) return null;
    const channels = this.effectiveChannels().filter((c) => c !== selected.name);
    if (channels.length === 0) return null;
    const ys = rows.map((r) => toNumber(r[selected.name]));
    let best: { name: string; corr: number } | null = null;
    for (const ch of channels) {
      const xs = rows.map((r) => toNumber(r[ch]));
      const corr = Math.abs(pearson(xs, ys));
      if (!best || corr > best.corr) best = { name: ch, corr };
    }
    return best?.name ?? null;
  });

  removeSelectedHealthChannel(): void {
    const selected = this.effectiveSelectedHealthChannel();
    if (!selected) return;
    this.removeVariable(selected.name);
    this.selectedHealthChannelName.set(null);
  }

  /** Pre-fills the existing real combine form (same combineColumns/combineChannels calls below) rather than combining immediately - Aggregate still needs an explicit click, same as picking channels manually always has. */
  combineSelectedWithSuggested(): void {
    const selected = this.effectiveSelectedHealthChannel();
    const partner = this.healthChannelSuggestedPartner();
    if (!selected || !partner) return;
    this.selectedCombineChannels.set([selected.name, partner]);
    this.newFieldName.set(`${selected.name}_${partner}_combined`.toLowerCase().replace(/[^a-z0-9]+/g, '_'));
    this.combineFormOpen.set(true);
    this.combineDropdownOpen.set(false);
  }

  combineEverythingFlagged(): void {
    const flagged = Array.from(new Set([...this.spendFlaggedChannels(), ...this.vifFlaggedChannels()]));
    if (flagged.length < 2) return;
    this.selectedCombineChannels.set(flagged);
    this.newFieldName.set('combined_flagged_channels');
    this.combineFormOpen.set(true);
    this.combineDropdownOpen.set(false);
  }

  removeEverythingFlagged(): void {
    const flagged = new Set([...this.spendFlaggedChannels(), ...this.vifFlaggedChannels()]);
    flagged.forEach((name) => this.removeVariable(name));
    this.selectedHealthChannelName.set(null);
  }

  /** "Or pick channels yourself" - the existing real combine form (Column type/Select variables/New field name/Aggregate), tucked behind a toggle instead of always visible. */
  readonly combineFormOpen = signal(false);

  toggleCombineForm(): void {
    this.combineFormOpen.update((open) => !open);
  }

  /** Exposure Metrics: per-control-column impact direction - no backend endpoint for this exists yet, still illustrative. */
  readonly exposureModes = signal<Record<string, ExposureMode>>({});
  readonly exposureToast = signal(false);
  private exposureToastTimer?: ReturnType<typeof setTimeout>;

  /**
   * Real suggested direction per control column - sign of the real Pearson
   * correlation between that column's real values and the real target
   * column's real values ('positive' = tends to coincide with a higher
   * target value in this dataset, 'negative' the opposite). Falls back to
   * 'auto' only when there's no real target/rows to check yet - a real
   * zero correlation still returns 'auto' since there's genuinely no
   * direction to suggest.
   */
  exposureSuggestion(col: string): ExposureMode {
    const target = this.config()?.targetColumn;
    const rows = this.rows();
    if (!target || rows.length === 0) return 'auto';
    const xs = rows.map((r) => toNumber(r[col]));
    const ys = rows.map((r) => toNumber(r[target]));
    const corr = pearson(xs, ys);
    if (corr === 0) return 'auto';
    return corr > 0 ? 'positive' : 'negative';
  }

  /** Explicit user choice if there is one, otherwise the real suggestion above - so a column starts pre-selected on its suggested direction instead of a blank 'auto'. */
  exposureMode(col: string): ExposureMode {
    return this.exposureModes()[col] ?? this.exposureSuggestion(col);
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

  /** Every column to its own real suggestion (not one mode for all - each column can suggest a different direction). */
  acceptAllSuggestions(): void {
    const next: Record<string, ExposureMode> = {};
    for (const col of this.controlColumnsList()) next[col] = this.exposureSuggestion(col);
    this.exposureModes.set(next);
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
   * Always fetches the real min/max date the backend found in the uploaded
   * file (GET /datasets/:id/date-range), so the Start/End inputs' min/max
   * attributes only allow picking dates that actually exist in this
   * dataset. On top of that, first-visit convenience: if this dataset has
   * never had an Optimize date range saved, also prefill Start/End with
   * those same real bounds - still fully editable. Requires Configuration
   * to already be saved; the 400 that comes back otherwise is expected
   * (this screen is unreachable before Configure anyway) and just leaves
   * everything blank, same as before this existed. The prefill only ever
   * runs if getDataset() already confirmed there's no real saved range to
   * protect - it never overwrites one.
   */
  private maybeSuggestDateRange(): void {
    this.datasetService.getDateRange(this.datasetId()).subscribe({
      next: ({ minDate, maxDate }) => {
        this.datasetMinDate.set(minDate);
        this.datasetMaxDate.set(maxDate);
        if (this.hasSavedDateRange) return;
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
