import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';

import { DatasetService } from '../../core/services/dataset.service';
import { SessionService } from '../../core/services/notification.service';
import { TunnelService } from '../../core/services/tunnel.service';
import { backendErrorMessage } from '../../shared/utils/backend-error';
import { PageHeader } from '../../shared/ui/page-header/page-header';
import { WizardTopbar } from '../../shared/ui/wizard-topbar/wizard-topbar';

function inRange(value: number | null): boolean {
  return value !== null && value >= 0 && value <= 100;
}

/**
 * Real backend: PATCH /datasets/:id/calibration, shipped 2026-08-12.
 * Confirmed directly against the real modeling engine (2026-08-19): it only
 * ever accepts one overall {contributionBeliefPercent, confidencePercent}
 * pair per dataset, never per-channel - this was never a placeholder for a
 * richer per-variable calibration flow, so this screen stays exactly this
 * simple on purpose.
 */
@Component({
  selector: 'app-calibrate',
  imports: [FormsModule, PageHeader, WizardTopbar],
  templateUrl: './calibrate.html',
  styleUrl: './calibrate.css',
})
export class Calibrate implements OnInit {
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly datasetService = inject(DatasetService);
  private readonly tunnelService = inject(TunnelService);
  private readonly session = inject(SessionService);

  /** Real 'read' role can view this screen but the real save-calibration endpoint 403s for it - disables Save. */
  readonly isReadOnly = this.session.isReadOnly;

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

  /** Defaults to on - most models do want a calibration entered. */
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
