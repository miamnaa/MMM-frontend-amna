import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';

import { DatasetService } from '../../core/services/dataset.service';
import { TunnelService } from '../../core/services/tunnel.service';
import { backendErrorMessage } from '../../shared/utils/backend-error';
import { PageHeader } from '../../shared/ui/page-header/page-header';
import { TunnelSteps } from '../../shared/ui/tunnel-steps/tunnel-steps';

function inRange(value: number | null): boolean {
  return value !== null && value >= 0 && value <= 100;
}

type VariableType = 'media' | 'control';

interface CalibrationEntry {
  id: number;
  variableType: VariableType;
  variable: string;
  metricLabel: string;
  periodLabel: string;
  actualValue: number;
  contributionBeliefPercent: number;
  confidencePercent: number;
}

/** Real backend: PATCH /datasets/:id/calibration, shipped 2026-08-12. */
@Component({
  selector: 'app-calibrate',
  imports: [FormsModule, PageHeader, TunnelSteps],
  templateUrl: './calibrate.html',
  styleUrl: './calibrate.css',
})
export class Calibrate implements OnInit {
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly datasetService = inject(DatasetService);
  private readonly tunnelService = inject(TunnelService);

  readonly projectId = signal('');
  readonly datasetId = signal('');
  readonly infoOpen = signal(false);

  readonly contributionBeliefPercent = signal<number | null>(null);
  readonly confidencePercent = signal<number | null>(null);

  readonly saving = signal(false);
  readonly saveError = signal<string | null>(null);

  /** Neutral values sent when the toggle below is switched off - real save, just not manually entered. */
  private static readonly DEFAULT_BELIEF = 50;
  private static readonly DEFAULT_CONFIDENCE = 50;

  /** Defaults to on, same as Cassandra's reference - most models do want a calibration entered. */
  readonly calibrationEnabled = signal(true);

  /** True once this dataset actually has a saved calibration - drives the right-hand summary panel. */
  readonly hasSavedCalibration = signal(false);

  toggleCalibration(): void {
    this.calibrationEnabled.update((on) => !on);
  }

  readonly canSave = computed(
    () =>
      !this.calibrationEnabled() ||
      (inRange(this.contributionBeliefPercent()) && inRange(this.confidencePercent())),
  );

  // ---- Guided "Add a calibration" wizard - matches the Cassandra reference's
  // step-by-step entry, but only two of these fields (Confidence level,
  // Contribution belief) map to anything the real PATCH /datasets/:id/calibration
  // endpoint accepts. Variable/Metric/Time period/Actual value are real user
  // input (not fabricated numbers) that help someone reason through what
  // belief/confidence to enter - "+ Add calibration" appends a labeled
  // snapshot to a local list for reference, and copies its belief/confidence
  // into the two fields that actually get saved. The backend has no concept
  // of multiple per-variable calibrations, so only the two numbers currently
  // in those fields are ever sent - the list is a scratchpad, not extra
  // server-side records.

  private readonly config = computed(() => this.tunnelService.configuration());

  readonly variableType = signal<VariableType>('media');

  readonly variableTypeOptions = computed(() => {
    const cfg = this.config();
    const opts: { value: VariableType; label: string }[] = [];
    if ((cfg?.mediaColumns.length ?? 0) > 0) opts.push({ value: 'media', label: 'Media' });
    if ((cfg?.controlColumns.length ?? 0) > 0) opts.push({ value: 'control', label: 'Control' });
    return opts;
  });

  readonly variableOptions = computed(() => {
    const cfg = this.config();
    return this.variableType() === 'media' ? cfg?.mediaColumns ?? [] : cfg?.controlColumns ?? [];
  });

  readonly selectedVariable = signal('');

  setVariableType(type: VariableType): void {
    this.variableType.set(type);
    this.selectedVariable.set('');
  }

  /** Purely descriptive - reflects the dataset's real saved KPI type, not sent anywhere. */
  readonly metricOptions = computed(() => {
    const revenue = this.config()?.kpiType === 'revenue';
    return revenue ? ['Revenue', 'ROAS'] : ['Conversions', 'CPA'];
  });

  readonly metricLabel = signal('Conversions');

  readonly timePeriodMode = signal<'full' | 'custom'>('full');
  readonly customStartDate = signal('');
  readonly customEndDate = signal('');

  /** The real saved date range from Optimize, when Full Period is selected. */
  readonly fullPeriodRange = computed(() => this.tunnelService.optimize());

  readonly periodLabel = computed(() => {
    if (this.timePeriodMode() === 'full') {
      const range = this.fullPeriodRange();
      return range ? `${range.startDate} to ${range.endDate}` : 'Full period';
    }
    return this.customStartDate() && this.customEndDate()
      ? `${this.customStartDate()} to ${this.customEndDate()}`
      : 'Custom range';
  });

  readonly actualValueDuringPeriod = signal<number | null>(null);

  readonly calibrationEntries = signal<CalibrationEntry[]>([]);
  private nextEntryId = 1;

  readonly canAddCalibration = computed(
    () =>
      this.selectedVariable().trim().length > 0 &&
      this.actualValueDuringPeriod() !== null &&
      inRange(this.contributionBeliefPercent()) &&
      inRange(this.confidencePercent()),
  );

  addCalibration(): void {
    if (!this.canAddCalibration()) return;
    this.calibrationEntries.update((entries) => [
      ...entries,
      {
        id: this.nextEntryId++,
        variableType: this.variableType(),
        variable: this.selectedVariable(),
        metricLabel: this.metricLabel(),
        periodLabel: this.periodLabel(),
        actualValue: this.actualValueDuringPeriod()!,
        contributionBeliefPercent: this.contributionBeliefPercent()!,
        confidencePercent: this.confidencePercent()!,
      },
    ]);
    this.selectedVariable.set('');
    this.actualValueDuringPeriod.set(null);
  }

  removeCalibrationEntry(id: number): void {
    this.calibrationEntries.update((entries) => entries.filter((e) => e.id !== id));
  }

  ngOnInit(): void {
    this.projectId.set(this.route.snapshot.paramMap.get('projectId') ?? '');
    this.datasetId.set(this.route.snapshot.paramMap.get('datasetId') ?? '');

    // Real endpoint (GET /datasets/:id, confirmed working 2026-08-13) - the
    // fix for leaving this screen and coming back to a blank form even
    // though calibration was already saved. Best-effort: a failure here
    // just leaves the fields blank, same as before this existed.
    this.datasetService.getDataset(this.datasetId()).subscribe({
      next: (detail) => {
        if (detail.calibration) {
          this.contributionBeliefPercent.set(detail.calibration.contributionBeliefPercent);
          this.confidencePercent.set(detail.calibration.confidencePercent);
          this.hasSavedCalibration.set(true);
        }
      },
      error: () => {},
    });
  }

  toggleInfo(): void {
    this.infoOpen.update((open) => !open);
  }

  save(): void {
    if (!this.canSave() || this.saving()) return;

    const body = this.calibrationEnabled()
      ? { contributionBeliefPercent: this.contributionBeliefPercent()!, confidencePercent: this.confidencePercent()! }
      : { contributionBeliefPercent: Calibrate.DEFAULT_BELIEF, confidencePercent: Calibrate.DEFAULT_CONFIDENCE };

    this.saving.set(true);
    this.saveError.set(null);

    this.datasetService.saveCalibration(this.datasetId(), body).subscribe({
      next: () => {
        this.saving.set(false);
        this.hasSavedCalibration.set(true);
        this.tunnelService.setCalibration(body);
        this.router.navigate(['/hyperparameters', this.projectId(), this.datasetId()]);
      },
      error: (err: unknown) => {
        this.saving.set(false);
        this.saveError.set(backendErrorMessage(err, 'Could not save this calibration. Try again.'));
      },
    });
  }
}
