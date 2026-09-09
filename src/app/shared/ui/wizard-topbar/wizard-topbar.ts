import { Component, computed, inject, input } from '@angular/core';
import { Router } from '@angular/router';

export type TunnelStepKey = 'upload-data' | 'configure' | 'optimize' | 'calibrate' | 'hyperparameters';

interface StepDef {
  key: TunnelStepKey;
  label: string;
  optional?: boolean;
}

/** Same 5 steps/order/labels the old TunnelSteps sidebar had (removed 2026-09-02, along with its reachability-gated clickable-link list - this only ever needs a plain index/count). */
const ALL_STEPS: StepDef[] = [
  { key: 'upload-data', label: 'Upload Data' },
  { key: 'configure', label: 'Configure' },
  { key: 'optimize', label: 'Optimize' },
  { key: 'calibrate', label: 'Calibrate', optional: true },
  { key: 'hyperparameters', label: 'Hyperparameterization', optional: true },
];

/**
 * Replaces the left TunnelSteps sidebar (2026-09-02 redesign) with a single
 * plain top bar - "← Back" / "Step X of N — Label" / an "Optional" pill on
 * steps that are - across all 5 tunnel screens. Every screen still only
 * moves forward via its own real Save/Continue action; this is wayfinding,
 * not another way to jump ahead (that's still real getDataset()/config
 * fetches per screen, and each step's own real context guard).
 */
@Component({
  selector: 'app-wizard-topbar',
  imports: [],
  templateUrl: './wizard-topbar.html',
  styleUrl: './wizard-topbar.css',
})
export class WizardTopbar {
  private readonly router = inject(Router);

  readonly projectId = input.required<string>();
  readonly current = input.required<TunnelStepKey>();
  /** Not needed from Upload Data (its own route has no :datasetId) - required by every other step to build that step's real route. */
  readonly datasetId = input<string>('');
  /**
   * Real, confirmed 2026-09-09 by reading PyMC's own pipeline source
   * directly: Calibrate's fields (contribution_belief_percent/
   * confidence_percent) are never read anywhere in PyMC's real code - only
   * Meridian uses them. The backend already stopped sending calibration to
   * PyMC. Anas's explicit call: a step that isn't usable isn't an option -
   * not a disabled state, not a note, just not shown - so Calibrate is
   * dropped from the step count/order entirely for a PyMC dataset.
   * Hyperparameterization stays as-is for both engines (confirmed aligned).
   */
  readonly modelType = input<string>('');

  private readonly steps = computed<StepDef[]>(() =>
    this.modelType() === 'pymc' ? ALL_STEPS.filter((s) => s.key !== 'calibrate') : ALL_STEPS,
  );

  private readonly currentIndex = computed(() => this.steps().findIndex((s) => s.key === this.current()));
  readonly stepNumber = computed(() => this.currentIndex() + 1);
  readonly totalSteps = computed(() => this.steps().length);
  readonly stepLabel = computed(() => this.steps()[this.currentIndex()]?.label ?? '');
  readonly isOptional = computed(() => this.steps()[this.currentIndex()]?.optional ?? false);

  /**
   * Goes to the previous tunnel step (2026-09-02 - real per-step back,
   * replacing the old TunnelSteps.back() which always jumped straight out
   * to the Models list from every step). Only Upload Data (no step before
   * it) still exits to this project's own Models list. Uses the same
   * PyMC-filtered step list, so Hyperparameterization's "Back" goes
   * straight to Optimize for a PyMC dataset, skipping the Calibrate step
   * it never actually visited.
   */
  back(): void {
    const steps = this.steps();
    const previous = steps[this.currentIndex() - 1];
    if (!previous) {
      this.router.navigate(['/models', this.projectId()]);
      return;
    }
    if (previous.key === 'upload-data') {
      this.router.navigate(['/upload-data', this.projectId()]);
      return;
    }
    this.router.navigate([`/${previous.key}`, this.projectId(), this.datasetId()]);
  }
}
