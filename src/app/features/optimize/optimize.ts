import { DecimalPipe } from '@angular/common';
import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { forkJoin, of } from 'rxjs';

import { AutoCombinedGroup, ChannelHealthApiRow, DatasetService, ExposureDirection, ExposureMetricRow, HyperparameterChannel, SavedColumnMapping } from '../../core/services/dataset.service';
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

interface ChartSeries {
  name: string;
  color: string;
  points: string;
}

interface ChannelHealthPoint {
  name: string;
  spendPct: number;
  /** Real, but can still be null - only one real media channel exists (nothing to compare against), or fewer real rows than channels (not enough data for a stable fit). Never treated as zero. */
  vif: number | null;
  /** True when `vif` came from the real ridge-regularized fallback (exact collinearity case) rather than the plain formula - still a real, computed number, just worth a softer caveat. */
  vifIsApproximate: boolean;
  mostCorrelatedWith: string | null;
  mostCorrelatedValue: number | null;
  x: number;
  y: number;
  status: 'both' | 'one' | 'healthy' | 'unknown';
}

/** Strips a trailing " Cost" (however it's cased) from a real column name for display only - real uploaded files commonly name spend columns "X Cost", which reads cleaner in a chart label as just "X". Every action (remove/combine) still targets the real, unshortened name. */
function displayName(name: string): string {
  const stripped = name.replace(/\s*cost$/i, '').trim();
  return stripped.length > 0 ? stripped : name;
}

type ExposureMode = 'helps' | 'hurts' | 'not_sure';
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
  /** Real, visible failure when the backend's own real min/max come back malformed or backwards (seen for real: a "clean" test file with non-ISO dates produced a max date earlier than its min date) - rather than silently leaving the Start/End pickers blank with no explanation, same honesty rule as every other real-data failure in this app. */
  readonly dateRangeError = signal<string | null>(null);

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
  private readonly organicColumnsList = computed(() => this.config()?.organicColumns ?? []);
  /** Real GET /datasets/:id/exposure-metrics covers both groups in one call - Exposure Metrics shows them together as a single list. */
  readonly exposureColumnsList = computed(() => [...this.controlColumnsList(), ...this.organicColumnsList()]);

  readonly hasMediaChannels = computed(() => this.mediaChannels().length > 0);
  readonly hasControlColumns = computed(() => this.exposureColumnsList().length > 0);

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

/** Pushes a real updated columnMapping into TunnelService so the rest of the tunnel (Hyperparameters' channel list, etc.) reflects the real combined state, not the pre-combine one - and re-fetches real Channel Health, since combining channels for real changes the real VIF/correlation numbers it's built from. */
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
    this.loadChannelHealth();
    this.loadExposureMetrics();
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

  /**
   * Channel Health: real per-channel spend share, VIF, and most-correlated
   * partner, all from the real GET /datasets/:id/channel-health endpoint
   * (added 2026-09-07) - replaces the client-side VIF/correlation math this
   * used to compute itself. The spend-cutoff and VIF-cutoff sliders stay
   * entirely client-side on purpose (see spendCutoffPct/vifCutoffValue
   * below) - re-flagging on a slider drag re-classifies these same real
   * numbers instantly, without a network round-trip.
   */
  private readonly removedVariables = signal<Set<string>>(new Set());
  readonly channelHealthData = signal<ChannelHealthApiRow[]>([]);
  readonly channelHealthLoading = signal(false);
  readonly channelHealthError = signal<string | null>(null);

  private loadChannelHealth(): void {
    this.channelHealthLoading.set(true);
    this.channelHealthError.set(null);
    this.datasetService.getChannelHealth(this.datasetId()).subscribe({
      next: ({ channels }) => {
        this.channelHealthLoading.set(false);
        this.channelHealthData.set(channels);
        if (!this.spendCutoffTouched()) {
          this.spendCutoffPct.set(this.defaultSpendCutoffPct(channels.length));
        }
      },
      error: (err: unknown) => {
        this.channelHealthLoading.set(false);
        this.channelHealthError.set(backendErrorMessage(err, "Couldn't load Channel Health for this dataset."));
      },
    });
  }

  /**
   * There's no statistical convention for "too small a channel to trust" -
   * unlike VIF, it's a business judgment call with nothing to derive it
   * from. This at least grounds the *default* in this dataset's real
   * channel count instead of a flat guess: half of what an equal split of
   * spend across all real channels would give each one. E.g. 5 channels ->
   * an equal split is 20% each -> default cutoff flags anything under 10%.
   * Still just a starting point - the slider is there because there's no
   * "correct" number.
   */
  private defaultSpendCutoffPct(channelCount: number): number {
    if (channelCount <= 0) return 0;
    return Math.round((50 / channelCount) * 10) / 10;
  }

  private readonly visibleChannelHealthData = computed(() =>
    this.channelHealthData().filter((row) => !this.removedVariables().has(row.channel)),
  );

  removeVariable(name: string): void {
    this.removedVariables.update((set) => new Set(set).add(name));
  }

  protected readonly maxVif = computed(() => {
    const real = this.channelHealthData()
      .map((r) => r.vif)
      .filter((v): v is number => v !== null);
    return Math.max(5, ...real);
  });
  protected readonly maxSpendPct = computed(() => Math.max(5, ...this.channelHealthData().map((r) => r.shareOfSpendPercent)));

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

  /**
   * Real channel points on the scatter, classified against whichever
   * cutoff sliders are currently on. A real null VIF (only one real media
   * channel, or fewer real rows than channels) gets its own 'unknown'
   * status - it's never treated as healthy (0) or flagged, and is plotted
   * at the very bottom of the VIF axis with a visually distinct marker so
   * it doesn't read as "confirmed low redundancy" it isn't. An approximate
   * (ridge-regularized) VIF still classifies normally against the cutoff -
   * it's a real number, just flagged for a softer caveat in the UI.
   */
  readonly channelHealthPoints = computed<ChannelHealthPoint[]>(() => {
    const spendCutoff = this.spendCutoffEnabled() ? this.spendCutoffPct() : -Infinity;
    const vifCutoff = this.vifCutoffEnabled() ? this.vifCutoffValue() : Infinity;
    return this.visibleChannelHealthData().map((row) => {
      const vif = row.vif;
      const lowSpend = row.shareOfSpendPercent < spendCutoff;
      const highVif = vif !== null && vif > vifCutoff;
      const status: ChannelHealthPoint['status'] =
        vif === null ? 'unknown' : lowSpend && highVif ? 'both' : lowSpend || highVif ? 'one' : 'healthy';
      return {
        name: row.channel,
        spendPct: row.shareOfSpendPercent,
        vif,
        vifIsApproximate: row.vifIsApproximate,
        mostCorrelatedWith: row.mostCorrelatedWith,
        mostCorrelatedValue: row.mostCorrelatedValue,
        x: this.healthX(row.shareOfSpendPercent),
        y: vif === null ? this.healthPlotBottom : this.healthY(vif),
        status,
      };
    });
  });

  readonly hasChannelHealthData = computed(() => this.channelHealthPoints().length > 0);

  protected displayChannelName(name: string): string {
    return displayName(name);
  }

  protected displayChannelList(names: string[]): string {
    return names.map((n) => displayName(n)).join(', ');
  }

  /** Explicitly dismissed via the panel's ✕ - cleared again the next time a channel is picked, so the panel doesn't just reappear on its own after being closed but still opens right back up on the next real click. */
  readonly healthPanelClosed = signal(false);

  closeHealthPanel(): void {
    this.healthPanelClosed.set(true);
  }

  /** Points are also labeled on hover with exact figures - the always-on labels above give the name and rough position, the tooltip gives the real spend %/VIF numbers behind it. */
  readonly hoveredHealthPoint = signal<{ xPct: number; yPct: number; name: string; spendPct: number; vif: number | null; vifIsApproximate: boolean } | null>(null);

  showHealthTooltip(point: ChannelHealthPoint): void {
    this.hoveredHealthPoint.set({
      xPct: (point.x / HEALTH_W) * 100,
      yPct: (point.y / HEALTH_H) * 100,
      name: point.name,
      spendPct: point.spendPct,
      vif: point.vif,
      vifIsApproximate: point.vifIsApproximate,
    });
  }

  hideHealthTooltip(): void {
    this.hoveredHealthPoint.set(null);
  }

  readonly spendCutoffEnabled = signal(true);
  /** Real default, not a guess - see defaultSpendCutoffPct(). Overwritten once real channel data loads, unless the user has already touched the slider. */
  readonly spendCutoffPct = signal(3);
  readonly spendCutoffTouched = signal(false);
  setSpendCutoffPct(value: number): void {
    this.spendCutoffTouched.set(true);
    this.spendCutoffPct.set(value);
  }
  readonly vifCutoffEnabled = signal(true);
  /** 5 = the standard textbook threshold for "moderate multicollinearity concern" (10 is the usual "severe" line) - the one cutoff here that actually comes from a real statistical convention, not a guess. */
  readonly vifCutoffValue = signal(5);

  readonly spendFlaggedChannels = computed(() =>
    this.channelHealthPoints().filter((p) => p.spendPct < this.spendCutoffPct()).map((p) => p.name),
  );
  readonly vifFlaggedChannels = computed(() =>
    this.channelHealthPoints().filter((p) => p.vif !== null && p.vif > this.vifCutoffValue()).map((p) => p.name),
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
    this.healthPanelClosed.set(false);
  }

  /** Real most-correlated other channel - read directly off the selected channel's own real channel-health row (mostCorrelatedWith), already computed server-side from the actual uploaded data. No separate calculation needed here. */
  readonly healthChannelSuggestedPartner = computed<string | null>(() => this.effectiveSelectedHealthChannel()?.mostCorrelatedWith ?? null);

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

  /**
   * Exposure Metrics: real per-column suggested direction and explicit
   * user choice, from GET /datasets/:id/exposure-metrics (added
   * 2026-09-07) - replaces the client-side Pearson correlation this used
   * to compute itself. Covers every real control + organic column in one
   * call. Saving a direction (PATCH /datasets/:id/exposure-directions,
   * called from save() below) doesn't yet change a real training run's
   * outcome - that's a separate real open question for Hammad (does his
   * engine support a sign-constrained prior per column) - so nothing here
   * should imply this does more than record the choice.
   */
  readonly exposureMetricsData = signal<ExposureMetricRow[]>([]);
  readonly exposureMetricsLoading = signal(false);
  readonly exposureMetricsError = signal<string | null>(null);
  readonly exposureModes = signal<Record<string, ExposureMode>>({});
  readonly exposureToast = signal(false);
  private exposureToastTimer?: ReturnType<typeof setTimeout>;

  private loadExposureMetrics(): void {
    if (this.exposureColumnsList().length === 0) return;
    this.exposureMetricsLoading.set(true);
    this.exposureMetricsError.set(null);
    this.datasetService.getExposureMetrics(this.datasetId()).subscribe({
      next: ({ metrics }) => {
        this.exposureMetricsLoading.set(false);
        this.exposureMetricsData.set(metrics);
      },
      error: (err: unknown) => {
        this.exposureMetricsLoading.set(false);
        this.exposureMetricsError.set(backendErrorMessage(err, "Couldn't load Exposure Metrics for this dataset."));
      },
    });
  }

  /** Real suggested direction from the backend - 'not_sure' (a safe default, not a real correlation-backed answer) until the real data has loaded. */
  exposureSuggestion(col: string): ExposureMode {
    return this.exposureMetricsData().find((m) => m.column === col)?.suggestedDirection ?? 'not_sure';
  }

  /** Explicit user choice if there is one, otherwise the real suggestion above - so a column starts pre-selected on its suggested direction instead of a blank 'not_sure'. */
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
    for (const col of this.exposureColumnsList()) next[col] = this.exposureSuggestion(col);
    this.exposureModes.set(next);
    this.flashExposureToast();
  }

  setAllExposure(mode: ExposureMode): void {
    const next: Record<string, ExposureMode> = {};
    for (const col of this.exposureColumnsList()) next[col] = mode;
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

    this.loadChannelHealth();
    this.loadExposureMetrics();
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
        const minValid = /^\d{4}-\d{2}-\d{2}$/.test(minDate);
        const maxValid = /^\d{4}-\d{2}-\d{2}$/.test(maxDate);

        if (!minValid || !maxValid || minDate > maxDate) {
          this.dateRangeError.set(
            "Couldn't determine this dataset's real date range - the file's date column doesn't look like " +
              'YYYY-MM-DD. Fix the date format in your source file and re-upload, or enter Start/End manually below.',
          );
          return;
        }

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

    // Real PATCH /datasets/:id/exposure-directions - must include every
    // real control + organic column exactly once, same rule
    // Hyperparameterization already enforces for media channels. Skipped
    // entirely when there are none, rather than sending an empty array.
    const exposureColumns = this.exposureColumnsList();
    const exposureSave =
      exposureColumns.length > 0
        ? this.datasetService.saveExposureDirections(
            this.datasetId(),
            exposureColumns.map((column): ExposureDirection => ({ column, direction: this.exposureMode(column) })),
          )
        : of(null);

    forkJoin({
      optimize: this.datasetService.saveOptimize(this.datasetId(), body),
      exposure: exposureSave,
    }).subscribe({
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
