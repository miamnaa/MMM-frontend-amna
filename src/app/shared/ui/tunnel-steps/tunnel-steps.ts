import { Component, computed, inject, input } from '@angular/core';
import { Router } from '@angular/router';

import { TunnelService } from '../../../core/services/tunnel.service';

export type TunnelStepKey = 'upload-data' | 'configure';

interface StepDef {
  key: TunnelStepKey | 'optimize' | 'calibrate' | 'hyperparameterization';
  label: string;
  /** Steps with no real screen yet - shown for orientation, never clickable. */
  built: boolean;
}

const STEPS: StepDef[] = [
  { key: 'upload-data', label: 'Upload Data', built: true },
  { key: 'configure', label: 'Configure', built: true },
  { key: 'optimize', label: 'Optimize', built: false },
  { key: 'calibrate', label: 'Calibrate', built: false },
  { key: 'hyperparameterization', label: 'Hyperparameterization', built: false },
];

/**
 * A progress indicator for the Upload Data → Configure tunnel, not a
 * general navigation sidebar - it only ever links within this same
 * project's flow, and Configure only becomes clickable once a dataset
 * actually exists for this project (same check dataset-context.guard.ts
 * enforces server-side; this is just making that visible).
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
    if (!step.built) return false;
    if (step.key === 'upload-data') return true;
    if (step.key === 'configure') return this.hasDataset();
    return false;
  }

  go(step: StepDef): void {
    if (!this.isReachable(step) || step.key === this.current()) return;
    this.router.navigate([`/${step.key}`, this.projectId()]);
  }
}
