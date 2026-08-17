import { Component, computed, inject, input } from '@angular/core';
import { Router } from '@angular/router';

import { TunnelService } from '../../../core/services/tunnel.service';

export type TunnelStepKey = 'upload-data' | 'configure' | 'optimize' | 'calibrate' | 'hyperparameters';

interface StepDef {
  key: TunnelStepKey;
  label: string;
  optional?: boolean;
}

const STEPS: StepDef[] = [
  { key: 'upload-data', label: 'Upload Data' },
  { key: 'configure', label: 'Configure' },
  { key: 'optimize', label: 'Optimize' },
  { key: 'calibrate', label: 'Calibrate', optional: true },
  { key: 'hyperparameters', label: 'Hyperparameterization', optional: true },
];

/**
 * A progress indicator for the Upload Data → Configure → Optimize →
 * Calibrate → Hyperparameterization tunnel, not a general navigation
 * sidebar - it only ever links within this same project/dataset's flow.
 * Each step only becomes clickable once the one before it was actually
 * saved (same checks optimize/calibrate/hyperparameters-context.guard.ts
 * enforce server-side; this just makes that visible).
 */
@Component({
  selector: 'app-tunnel-steps',
  imports: [],
  templateUrl: './tunnel-steps.html',
  styleUrl: './tunnel-steps.css',
})
export class TunnelSteps {
  private readonly tunnelService = inject(TunnelService);
  private readonly router = inject(Router);

  readonly projectId = input.required<string>();
  readonly current = input.required<TunnelStepKey>();

  readonly steps = STEPS;

  readonly hasDataset = computed(
    () => this.tunnelService.projectId() === this.projectId() && this.tunnelService.dataset() !== null,
  );

  isReachable(step: StepDef): boolean {
    if (step.key === 'upload-data') return true;
    if (step.key === 'configure') return this.hasDataset();
    if (step.key === 'optimize') return this.hasDataset() && this.tunnelService.configuration() !== null;
    if (step.key === 'calibrate') return this.hasDataset() && this.tunnelService.optimize() !== null;
    if (step.key === 'hyperparameters') return this.hasDataset() && this.tunnelService.calibration() !== null;
    return false;
  }

  go(step: StepDef): void {
    if (!this.isReachable(step) || step.key === this.current()) return;
    if (step.key === 'upload-data') {
      this.router.navigate(['/upload-data', this.projectId()]);
      return;
    }
    const datasetId = this.tunnelService.dataset()?.id;
    if (!datasetId) return;
    this.router.navigate([`/${step.key}`, this.projectId(), datasetId]);
  }

  /** Replaces the old shared top bar (removed 2026-08-13) - the way out of the tunnel now lives here, straight to the Project list. */
  back(): void {
    this.router.navigate(['/projects']);
  }
}
