import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';

import { DatasetService, HyperparameterChannel } from '../../core/services/dataset.service';
import { TunnelService } from '../../core/services/tunnel.service';
import { backendErrorMessage } from '../../shared/utils/backend-error';
import { PageHeader } from '../../shared/ui/page-header/page-header';
import { TunnelSteps } from '../../shared/ui/tunnel-steps/tunnel-steps';

const CHART_WIDTH = 640;
const CHART_HEIGHT = 200;
const CHART_PAD = 8;
const SERIES_COLORS = ['#e0554f', '#1baf7a', '#3b82f6', '#f59e0b', '#8b5cf6', '#0891b2'];
const WEEK_COUNT = 10;

/**
 * Deterministic "random" number from a string seed, so the same channel
 * name always produces the same example value on every render (no flicker,
 * no re-render surprises) - not real randomness, just a stand-in until real
 * row-level data has somewhere to come from.
 */
function seededValue(seed: string, min: number, max: number): number {
  let hash = 0;
  for (let i = 0; i < seed.length; i++) hash = (hash * 31 + seed.charCodeAt(i)) >>> 0;
  const t = (hash % 10000) / 10000;
  return min + t * (max - min);
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

/** Real backend: PATCH /datasets/:id/optimize, shipped 2026-08-12. */
@Component({
  selector: 'app-optimize',
  imports: [FormsModule, PageHeader, TunnelSteps],
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

  readonly saving = signal(false);
  readonly saveError = signal<string | null>(null);

  readonly infoOpen = signal(false);

  toggleInfo(): void {
    this.infoOpen.update((open) => !open);
  }

  /** Mirrors the backend's own 400 rule - caught here before round-tripping. */
  readonly rangeInvalid = computed(
    () => this.startDate().length > 0 && this.endDate().length > 0 && this.startDate() >= this.endDate(),
  );

  readonly canSave = computed(
    () => this.startDate().length > 0 && this.endDate().length > 0 && !this.rangeInvalid(),
  );

  // ---- Everything below is illustrative only - see the "Example data" badge
  // on each section. Real channel/target/control NAMES come from Configure's
  // saved mapping (real), but no backend endpoint returns actual row-level
  // values for a dataset yet, so the numbers themselves are generated,
  // deterministic placeholders until one exists. Nothing here is saved.

  private readonly config = computed(() => this.tunnelService.configuration());
  private readonly mediaChannels = computed(() => this.config()?.mediaColumns ?? []);
  readonly controlColumnsList = computed(() => this.config()?.controlColumns ?? []);

  readonly hasMediaChannels = computed(() => this.mediaChannels().length > 0);
  readonly hasControlColumns = computed(() => this.controlColumnsList().length > 0);

  /**
   * Channels review: combining two correlated channels into one. Nothing
   * here is a real backend "aggregate columns" call (none exists) - like
   * every other Optimize example section, it's local-only, driving the same
   * illustrative chart/correlation/spend-share numbers below it.
   */
  readonly combinedGroups = signal<{ name: string; members: string[] }[]>([]);

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

  readonly canAggregate = computed(
    () => this.selectedCombineChannels().length >= 2 && this.newFieldName().trim().length > 0,
  );

  aggregateChannels(): void {
    if (!this.canAggregate()) return;
    this.combinedGroups.update((groups) => [
      ...groups,
      { name: this.newFieldName().trim(), members: this.selectedCombineChannels() },
    ]);
    this.selectedCombineChannels.set([]);
    this.newFieldName.set('');
  }

  /** Custom Timeframe: example weekly trend for the target + up to 5 media channels. */
  readonly chartSeries = computed<ChartSeries[]>(() => {
    const target = this.config()?.targetColumn;
    const names = [target, ...this.effectiveChannels()].filter((n): n is string => !!n).slice(0, 6);
    return names.map((name, i) => {
      const values = Array.from({ length: WEEK_COUNT }, (_, w) => seededValue(`${name}-${w}`, 15, 92));
      const points = values
        .map((v, w) => {
          const x = CHART_PAD + (w / (WEEK_COUNT - 1)) * (CHART_WIDTH - CHART_PAD * 2);
          const y = CHART_HEIGHT - CHART_PAD - (v / 100) * (CHART_HEIGHT - CHART_PAD * 2);
          return `${x.toFixed(1)},${y.toFixed(1)}`;
        })
        .join(' ');
      return { name, color: SERIES_COLORS[i % SERIES_COLORS.length], points };
    });
  });

  readonly chartViewBox = `0 0 ${CHART_WIDTH} ${CHART_HEIGHT}`;

  /** Channels Review: example correlation between every media-channel pair, highest first. */
  private readonly removedPairs = signal<Set<string>>(new Set());

  readonly correlationRows = computed<CorrelationRow[]>(() => {
    const channels = this.effectiveChannels();
    const rows: CorrelationRow[] = [];
    for (let i = 0; i < channels.length; i++) {
      for (let j = i + 1; j < channels.length; j++) {
        rows.push({ a: channels[i], b: channels[j], pct: Math.round(seededValue(`${channels[i]}|${channels[j]}`, 35, 92)) });
      }
    }
    return rows.sort((r1, r2) => r2.pct - r1.pct).slice(0, 8);
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

  /** Variable Selection Review: example share-of-spend per media channel. */
  private readonly removedVariables = signal<Set<string>>(new Set());

  readonly spendShareBars = computed<SpendShareBar[]>(() => {
    const channels = this.effectiveChannels();
    const raw = channels.map((name) => ({ name, raw: seededValue(name, 3, 25) }));
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

  /** Exposure Metrics: per-control-column impact direction - illustrative, not saved anywhere real yet. */
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
          this.startDate.set(detail.dateRange.startDate);
          this.endDate.set(detail.dateRange.endDate);
        }
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
