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
  carryover: number | null;
  saturation: number | null;
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

  readonly canSave = computed(() => this.rows().length > 0 && this.rows().every(validRow));

  ngOnInit(): void {
    this.projectId.set(this.route.snapshot.paramMap.get('projectId') ?? '');
    this.datasetId.set(this.route.snapshot.paramMap.get('datasetId') ?? '');

    // Guaranteed non-empty by hyperparametersContextGuard, which requires
    // Configuration to have been saved first.
    const mediaColumns = this.tunnelService.configuration()?.mediaColumns ?? [];
    this.rows.set(mediaColumns.map((channel) => ({ channel, carryover: null, saturation: null })));

    // Real endpoint (GET /datasets/:id, confirmed working 2026-08-13) - the
    // channel names above were already correct, but carryover/saturation
    // used to always start blank even when already saved. Best-effort: a
    // failure here just leaves them blank, same as before this existed.
    this.datasetService.getDataset(this.datasetId()).subscribe({
      next: (detail) => {
        const saved = detail.channelHyperparameters;
        if (!saved || saved.length === 0) return;
        this.rows.update((rows) =>
          rows.map((row) => {
            const match = saved.find((s) => s.channel === row.channel);
            return match ? { ...row, carryover: match.carryover, saturation: match.saturation } : row;
          }),
        );
      },
      error: () => {},
    });
  }

  updateCarryover(index: number, value: number | null): void {
    this.rows.update((rows) => rows.map((r, i) => (i === index ? { ...r, carryover: value } : r)));
  }

  updateSaturation(index: number, value: number | null): void {
    this.rows.update((rows) => rows.map((r, i) => (i === index ? { ...r, saturation: value } : r)));
  }

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
