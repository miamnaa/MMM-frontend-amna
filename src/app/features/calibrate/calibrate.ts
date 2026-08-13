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

  readonly canSave = computed(
    () => inRange(this.contributionBeliefPercent()) && inRange(this.confidencePercent()),
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

    const body = {
      contributionBeliefPercent: this.contributionBeliefPercent()!,
      confidencePercent: this.confidencePercent()!,
    };

    this.saving.set(true);
    this.saveError.set(null);

    this.datasetService.saveCalibration(this.datasetId(), body).subscribe({
      next: () => {
        this.saving.set(false);
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
