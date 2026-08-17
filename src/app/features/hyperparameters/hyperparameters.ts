import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';

import { DatasetService, HyperparameterChannel } from '../../core/services/dataset.service';
import { TunnelService } from '../../core/services/tunnel.service';
import { backendErrorMessage } from '../../shared/utils/backend-error';
import { PageHeader } from '../../shared/ui/page-header/page-header';
import { TunnelSteps } from '../../shared/ui/tunnel-steps/tunnel-steps';

interface ChannelRow {
  channel: string;
  /** Committed values - what Save actually sends. */
  carryover: number | null;
  saturation: number | null;
  /**
   * Draft slider positions - what the chart previews live while dragging.
   * Manual edits only become the committed value once Apply is clicked;
   * Randomize commits immediately since it's a one-shot action, not a drag.
   */
  carryoverDraft: number;
  saturationDraft: number;
  adstockOpen: boolean;
  saturationOpen: boolean;
  /** Automatic Optimization's search range - AdStock only, see below. */
  adstockVariance: number;
  /**
   * Alpha - the illustrative curve's half-saturation spend point (as a
   * fraction of the illustrative max spend axis). There's no second
   * backend field to store this in - only `saturation` (shown as Gamma) is
   * ever sent to PATCH /datasets/:id/hyperparameters - so Alpha only shapes
   * the local preview chart, same honesty rule as the illustrative spend axis.
   */
  alpha: number;
  /**
   * True right after Automatic Optimization sets this value - cleared as
   * soon as the user touches the slider or Applies a manual edit. Drives
   * the "Estimated" label: real training may pick a different value once
   * that's connected for real, same honesty rule as the mock training
   * results elsewhere in this app. AdStock only - Diminishing Returns has
   * no Automatic Optimization button.
   */
  carryoverEstimated: boolean;
}

function validRow(row: ChannelRow): boolean {
  return (
    row.carryover !== null &&
    row.carryover >= 0 &&
    row.carryover <= 1 &&
    row.saturation !== null &&
    row.saturation >= 0
  );
}

const DEFAULT_CARRYOVER = 0.4;
const DEFAULT_SATURATION = 1;
const DEFAULT_ALPHA = 0.5;
const DEFAULT_VARIANCE = 20;

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

const CHART_WIDTH = 560;
const CHART_HEIGHT = 160;
// Extra left/bottom room for axis tick labels (plus a rotated axis title on
// the left) - top/right stay tight.
const CHART_PAD_TOP = 10;
const CHART_PAD_RIGHT = 10;
const CHART_PAD_LEFT = 44;
const CHART_PAD_BOTTOM = 22;
const ADSTOCK_WEEKS = 15;
const SATURATION_STEPS = 16;
const SATURATION_MAX_SPEND = 5500;

function plotX(fraction: number): number {
  return CHART_PAD_LEFT + fraction * (CHART_WIDTH - CHART_PAD_LEFT - CHART_PAD_RIGHT);
}

function plotY(value: number): number {
  return (
    CHART_HEIGHT -
    CHART_PAD_BOTTOM -
    (Math.min(100, Math.max(0, value)) / 100) * (CHART_HEIGHT - CHART_PAD_TOP - CHART_PAD_BOTTOM)
  );
}

interface ChartPoint {
  x: number;
  y: number;
  label: string;
  value: number;
}

function toPointList(values: number[], labels: string[]): ChartPoint[] {
  return values.map((v, i) => ({
    x: plotX(i / (values.length - 1)),
    y: plotY(v),
    label: labels[i],
    value: Math.round(Math.min(100, Math.max(0, v)) * 10) / 10,
  }));
}

function pointsAttr(points: ChartPoint[]): string {
  return points.map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ');
}

/** theta^(week-1) * 100 - the standard AdStock decay curve for a real carryover value. */
function adstockPointList(theta: number): ChartPoint[] {
  const values = Array.from({ length: ADSTOCK_WEEKS }, (_, w) => 100 * Math.pow(theta, w));
  const labels = values.map((_, w) => `Week ${w + 1}`);
  return toPointList(values, labels);
}

/**
 * Hill-type saturation curve: spend^gamma / (halfPoint^gamma + spend^gamma).
 * Gamma (the real, saved `saturation` field) controls how sharply the curve
 * bends; alpha (illustrative-only, see ChannelRow) sets where the half-max
 * point sits along the illustrative spend axis.
 */
function saturationPointList(alpha: number, gamma: number): ChartPoint[] {
  const halfPoint = Math.max(0.01, alpha) * SATURATION_MAX_SPEND;
  const g = gamma || 0.01;
  const spends = Array.from({ length: SATURATION_STEPS }, (_, i) => (SATURATION_MAX_SPEND / (SATURATION_STEPS - 1)) * i);
  const values = spends.map((spend) => {
    const spendG = Math.pow(spend, g);
    return (100 * spendG) / (Math.pow(halfPoint, g) + spendG);
  });
  const labels = spends.map((s) => `$${Math.round(s).toLocaleString()}`);
  return toPointList(values, labels);
}

/**
 * Real backend: PATCH /datasets/:id/hyperparameters, shipped 2026-08-12.
 * The backend requires `channels` to contain exactly the same names as
 * Configure's saved mediaColumns - no more, no fewer. Channel names here
 * are read-only, pre-filled from TunnelService.configuration(), not typed
 * by the user, which is what guarantees that match (no retyping, no typos).
 */
@Component({
  selector: 'app-hyperparameters',
  imports: [FormsModule, PageHeader, TunnelSteps],
  templateUrl: './hyperparameters.html',
  styleUrl: './hyperparameters.css',
})
export class Hyperparameters implements OnInit {
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly datasetService = inject(DatasetService);
  private readonly tunnelService = inject(TunnelService);

  readonly projectId = signal('');
  readonly datasetId = signal('');
  readonly rows = signal<ChannelRow[]>([]);

  readonly saving = signal(false);
  readonly saveError = signal<string | null>(null);
  readonly saved = signal(false);

  readonly infoOpen = signal(false);
  toggleInfo(): void {
    this.infoOpen.update((open) => !open);
  }

  /** One channel expanded at a time, like the reference - first channel opens by default. */
  readonly expandedIndex = signal<number | null>(null);
  toggleChannel(index: number): void {
    this.expandedIndex.update((current) => (current === index ? null : index));
  }

  readonly canSave = computed(() => this.rows().length > 0 && this.rows().every(validRow));

  ngOnInit(): void {
    this.projectId.set(this.route.snapshot.paramMap.get('projectId') ?? '');
    this.datasetId.set(this.route.snapshot.paramMap.get('datasetId') ?? '');

    // Guaranteed non-empty by hyperparametersContextGuard, which requires
    // Configuration to have been saved first. Real, sensible starting values
    // (not fabricated data) so every slider/chart below has something
    // meaningful to show before the user touches anything - getDataset()
    // below overrides these with the real saved numbers if there are any.
    const mediaColumns = this.tunnelService.configuration()?.mediaColumns ?? [];
    this.rows.set(
      mediaColumns.map((channel) => ({
        channel,
        carryover: DEFAULT_CARRYOVER,
        saturation: DEFAULT_SATURATION,
        carryoverDraft: DEFAULT_CARRYOVER,
        saturationDraft: DEFAULT_SATURATION,
        adstockOpen: true,
        saturationOpen: true,
        adstockVariance: DEFAULT_VARIANCE,
        alpha: DEFAULT_ALPHA,
        carryoverEstimated: false,
      })),
    );
    if (mediaColumns.length > 0) this.expandedIndex.set(0);

    // Real endpoint (GET /datasets/:id, confirmed working 2026-08-13) - the
    // channel names above were already correct, but carryover/saturation
    // used to always start blank even when already saved. Best-effort: a
    // failure here just leaves them at the defaults set above.
    this.datasetService.getDataset(this.datasetId()).subscribe({
      next: (detail) => {
        const saved = detail.channelHyperparameters;
        if (!saved || saved.length === 0) return;
        this.rows.update((rows) =>
          rows.map((row) => {
            const match = saved.find((s) => s.channel === row.channel);
            return match
              ? {
                  ...row,
                  carryover: match.carryover,
                  saturation: match.saturation,
                  carryoverDraft: match.carryover,
                  saturationDraft: match.saturation,
                  carryoverEstimated: false,
                }
              : row;
          }),
        );
      },
      error: () => {},
    });
  }

  toggleAdstockOpen(index: number): void {
    this.rows.update((rows) => rows.map((r, i) => (i === index ? { ...r, adstockOpen: !r.adstockOpen } : r)));
  }

  toggleSaturationOpen(index: number): void {
    this.rows.update((rows) => rows.map((r, i) => (i === index ? { ...r, saturationOpen: !r.saturationOpen } : r)));
  }

  setCarryoverDraft(index: number, value: number): void {
    this.rows.update((rows) =>
      rows.map((r, i) => (i === index ? { ...r, carryoverDraft: value, carryoverEstimated: false } : r)),
    );
  }

  setSaturationDraft(index: number, value: number): void {
    this.rows.update((rows) => rows.map((r, i) => (i === index ? { ...r, saturationDraft: value } : r)));
  }

  setAlpha(index: number, value: number): void {
    this.rows.update((rows) => rows.map((r, i) => (i === index ? { ...r, alpha: value } : r)));
  }

  setAdstockVariance(index: number, value: number): void {
    this.rows.update((rows) => rows.map((r, i) => (i === index ? { ...r, adstockVariance: value } : r)));
  }

  /** Commits the current slider position as the real value that gets saved. */
  applyCarryover(index: number): void {
    this.rows.update((rows) => rows.map((r, i) => (i === index ? { ...r, carryover: r.carryoverDraft } : r)));
  }

  applySaturation(index: number): void {
    this.rows.update((rows) => rows.map((r, i) => (i === index ? { ...r, saturation: r.saturationDraft } : r)));
  }

  /**
   * A real local randomized search within +/-variance% of the current
   * committed value, applied immediately - not a call to a backend
   * optimizer (none exists), just an honest in-browser random draw the user
   * can see reflected on the chart and in the number field right away.
   */
  randomizeCarryover(index: number): void {
    const row = this.rows()[index];
    if (!row) return;
    const base = row.carryover ?? DEFAULT_CARRYOVER;
    const delta = (row.adstockVariance / 100) * base;
    const next = round2(clamp(base + (Math.random() * 2 - 1) * delta, 0, 1));
    this.rows.update((rows) =>
      rows.map((r, i) => (i === index ? { ...r, carryover: next, carryoverDraft: next, carryoverEstimated: true } : r)),
    );
  }

  adstockChartData(row: ChannelRow): ChartPoint[] {
    return adstockPointList(row.carryoverDraft);
  }

  adstockChartPoints(row: ChannelRow): string {
    return pointsAttr(this.adstockChartData(row));
  }

  saturationChartData(row: ChannelRow): ChartPoint[] {
    return saturationPointList(row.alpha, row.saturationDraft);
  }

  saturationChartPoints(row: ChannelRow): string {
    return pointsAttr(this.saturationChartData(row));
  }

  /** Single shared tooltip - only one chart point can be hovered at a time. */
  readonly hoveredPoint = signal<{ xPct: number; yPct: number; label: string; value: number } | null>(null);

  showTooltip(point: ChartPoint): void {
    this.hoveredPoint.set({
      xPct: (point.x / CHART_WIDTH) * 100,
      yPct: (point.y / CHART_HEIGHT) * 100,
      label: point.label,
      value: point.value,
    });
  }

  hideTooltip(): void {
    this.hoveredPoint.set(null);
  }

  readonly chartViewBox = `0 0 ${CHART_WIDTH} ${CHART_HEIGHT}`;
  readonly chartPlotLeft = CHART_PAD_LEFT;
  readonly chartPlotRight = CHART_WIDTH - CHART_PAD_RIGHT;
  readonly chartPlotBottom = CHART_HEIGHT - CHART_PAD_BOTTOM;
  readonly chartPlotTop = CHART_PAD_TOP;
  /** Rotated "Effect (%)" axis title, centered along the plot area's left edge. */
  readonly chartYLabelX = 12;
  readonly chartYLabelY = (CHART_PAD_TOP + (CHART_HEIGHT - CHART_PAD_BOTTOM)) / 2;
  readonly chartYLabelTransform = `rotate(-90 12 ${this.chartYLabelY})`;

  /** 0/25/50/75/100 gridlines - both charts plot on a 0-100 "Effect (%)" scale. */
  readonly yAxisTicks = [0, 25, 50, 75, 100].map((value) => ({ value, y: plotY(value) }));

  readonly adstockXTicks = Array.from({ length: ADSTOCK_WEEKS }, (_, w) => ({
    x: plotX(w / (ADSTOCK_WEEKS - 1)),
    label: String(w + 1),
  }));

  private static readonly SATURATION_X_LABEL_COUNT = 6;
  readonly saturationXTicks = Array.from({ length: Hyperparameters.SATURATION_X_LABEL_COUNT }, (_, i) => {
    const fraction = i / (Hyperparameters.SATURATION_X_LABEL_COUNT - 1);
    return { x: plotX(fraction), label: Math.round(fraction * SATURATION_MAX_SPEND).toLocaleString() };
  });

  save(): void {
    if (!this.canSave() || this.saving()) return;

    const channels: HyperparameterChannel[] = this.rows().map((r) => ({
      channel: r.channel,
      carryover: r.carryover!,
      saturation: r.saturation!,
    }));

    this.saving.set(true);
    this.saveError.set(null);
    this.saved.set(false);

    // No "start training" step exists on the backend yet, so there's
    // nowhere further to go in the tunnel itself - success moves back to
    // the Models list, which already shows this model as Ready 100% with
    // the same "Train Model - Coming soon" state. Brief delay so the
    // "Hyperparameters saved" confirmation is actually visible first.
    this.datasetService.saveHyperparameters(this.datasetId(), channels).subscribe({
      next: () => {
        this.saving.set(false);
        this.saved.set(true);
        setTimeout(() => this.router.navigate(['/models', this.projectId()]), 1200);
      },
      error: (err: unknown) => {
        this.saving.set(false);
        this.saveError.set(backendErrorMessage(err, 'Could not save these hyperparameters. Try again.'));
      },
    });
  }
}
