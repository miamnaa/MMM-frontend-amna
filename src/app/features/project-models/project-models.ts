import { Component, OnDestroy, OnInit, inject, signal } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { Subscription, interval } from 'rxjs';
import { switchMap, takeWhile } from 'rxjs/operators';

import {
  ApiProjectDataset,
  DatasetService,
  TrainingResults,
  isFailedTrainingStatus,
  isTerminalTrainingStatus,
} from '../../core/services/dataset.service';

/** Common field names the real backend might use for a channel's display name - checked in order, first match wins. */
const CHANNEL_NAME_KEYS = ['channel', 'channel_name', 'name', 'variable', 'media_channel'];

interface DisplayEntry {
  label: string;
  value: string;
}
import { Project } from '../../core/models/domain.models';
import { MODEL_STATUS_META, ModelStatus, computeModelStatus, resumeDatasetRoute } from '../../core/services/model-status';
import { ProjectService } from '../../core/services/project.service';
import { TunnelService } from '../../core/services/tunnel.service';
import { UploadDraftService } from '../../core/services/upload-draft.service';
import { EmptyState } from '../../shared/ui/empty-state/empty-state';
import { PageHeader } from '../../shared/ui/page-header/page-header';
import { backendErrorMessage } from '../../shared/utils/backend-error';

const POLL_INTERVAL_MS = 3000;

/**
 * 'idle' shows the real "Train Model" button; the rest track one real
 * training run against the three real endpoints Anas confirmed 2026-08-13
 * (POST .../train, GET .../status polled every 3s, GET .../results once
 * status reaches a terminal state). Results are real data from a real call,
 * but the backend itself is simulating the numbers right now, not running
 * an actual model - the UI says so, doesn't quietly present them as real.
 */
type TrainState =
  | { phase: 'idle' }
  | { phase: 'starting' }
  | { phase: 'training'; progress?: number; message?: string }
  | { phase: 'completed'; results: TrainingResults }
  | { phase: 'failed'; error: string };

interface ModelRow {
  dataset: ApiProjectDataset;
  status: ModelStatus;
  label: string;
  percent: number;
  training: TrainState;
}

/**
 * The project-level hub that was missing before - Cassandra's own
 * dashboard lists every model with a real status; this is the equivalent
 * for one project. Sits between the Project list and the per-model tunnel
 * (Upload Data → ... → Hyperparameters), which every one of those 5
 * screens' "Back" button now returns to.
 */
@Component({
  selector: 'app-project-models',
  imports: [PageHeader, EmptyState],
  templateUrl: './project-models.html',
  styleUrl: './project-models.css',
})
export class ProjectModels implements OnInit, OnDestroy {
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly projectService = inject(ProjectService);
  private readonly datasetService = inject(DatasetService);
  private readonly tunnelService = inject(TunnelService);
  private readonly uploadDraft = inject(UploadDraftService);

  readonly projectId = signal('');
  readonly project = signal<Project | null>(null);
  readonly rows = signal<ModelRow[]>([]);
  readonly loading = signal(true);
  readonly loadError = signal<string | null>(null);

  readonly deleteTarget = signal<ModelRow | null>(null);
  readonly deleting = signal(false);
  readonly deleteError = signal<string | null>(null);

  /** One poll subscription per dataset currently training - cleaned up on delete and on leaving this screen. */
  private readonly pollSubs = new Map<string, Subscription>();

  ngOnInit(): void {
    this.projectId.set(this.route.snapshot.paramMap.get('projectId') ?? '');
    this.load();
  }

  ngOnDestroy(): void {
    this.pollSubs.forEach((sub) => sub.unsubscribe());
  }

  load(): void {
    this.loading.set(true);
    this.loadError.set(null);

    this.projectService.get(this.projectId()).subscribe({
      next: (project) => this.project.set(project ?? null),
      error: (err: unknown) => console.error('Failed to load project details', err),
    });

    this.datasetService.listForProject(this.projectId()).subscribe({
      next: (datasets) => {
        this.rows.set(
          datasets.map((dataset) => {
            const status = computeModelStatus(dataset);
            return { dataset, status, ...MODEL_STATUS_META[status], training: { phase: 'idle' as const } };
          }),
        );
        this.loading.set(false);
      },
      error: () => {
        this.loadError.set("Could not load this project's models. Check your connection and try again.");
        this.loading.set(false);
      },
    });
  }

  private updateTraining(datasetId: string, training: TrainState): void {
    this.rows.update((list) => list.map((r) => (r.dataset.id === datasetId ? { ...r, training } : r)));
  }

  /** Real POST .../train, then polls the real .../status endpoint every 3s until it reaches a terminal state, then fetches the real (currently simulated) .../results. */
  startTraining(row: ModelRow): void {
    const id = row.dataset.id;
    if (row.training.phase !== 'idle' && row.training.phase !== 'failed') return;

    this.updateTraining(id, { phase: 'starting' });

    this.datasetService.trainModel(id).subscribe({
      next: () => {
        this.updateTraining(id, { phase: 'training' });
        this.pollTraining(id);
      },
      error: (err: unknown) => {
        this.updateTraining(id, { phase: 'failed', error: backendErrorMessage(err, 'Could not start training. Try again.') });
      },
    });
  }

  private pollTraining(id: string): void {
    this.pollSubs.get(id)?.unsubscribe();

    const sub = interval(POLL_INTERVAL_MS)
      .pipe(
        switchMap(() => this.datasetService.getTrainingStatus(id)),
        takeWhile((res) => !isTerminalTrainingStatus(res.status), true),
      )
      .subscribe({
        next: (res) => {
          if (!isTerminalTrainingStatus(res.status)) {
            this.updateTraining(id, { phase: 'training', progress: res.progress, message: res.message });
            return;
          }
          if (isFailedTrainingStatus(res.status)) {
            this.updateTraining(id, { phase: 'failed', error: res.errorMessage ?? res.message ?? 'Training failed.' });
            return;
          }
          this.datasetService.getResults(id).subscribe({
            next: (results) => this.updateTraining(id, { phase: 'completed', results }),
            error: (err: unknown) =>
              this.updateTraining(id, { phase: 'failed', error: backendErrorMessage(err, 'Training finished, but results could not be loaded.') }),
          });
        },
        error: (err: unknown) => {
          this.updateTraining(id, { phase: 'failed', error: backendErrorMessage(err, 'Lost track of this training run. Try again.') });
        },
      });

    this.pollSubs.set(id, sub);
  }

  /** `mock === true` -> simulated; `false` or absent -> a real trained model. Not fixed per-dataset - depends on whether the real engine was reachable when /train was called. */
  isMockResult(results: TrainingResults): boolean {
    return results.mock === true;
  }

  channelContributionRows(results: TrainingResults) {
    return results.channel_contribution ?? [];
  }

  channelEfficiencyRows(results: TrainingResults) {
    return results.channel_efficiency ?? [];
  }

  /** First matching name-like field on a channel row, falling back to a positional label if the real field name doesn't match any of the guesses. */
  channelLabel(row: Record<string, unknown>, index: number): string {
    for (const key of CHANNEL_NAME_KEYS) {
      const value = row[key];
      if (typeof value === 'string' && value.length > 0) return value;
    }
    return `Channel ${index + 1}`;
  }

  formatPercent(value: unknown): string {
    return typeof value === 'number' ? `${Math.round(value * 10) / 10}%` : '—';
  }

  formatDecimal(value: unknown): string {
    return typeof value === 'number' ? value.toFixed(3) : '—';
  }

  formatCurrency(value: unknown): string {
    return typeof value === 'number' ? `$${new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 }).format(value)}` : '—';
  }

  private humanizeKey(key: string): string {
    return key.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
  }

  private formatPrimitive(value: unknown): string {
    if (value === null || value === undefined) return '—';
    if (typeof value === 'number') return new Intl.NumberFormat('en-US', { maximumFractionDigits: 2 }).format(value);
    if (typeof value === 'boolean') return value ? 'Yes' : 'No';
    return String(value);
  }

  /**
   * Turns any unknown value (object, array, or primitive) into simple
   * label/value rows for display - the fix for results fields rendering as
   * literal "[object Object]" text. Recurses into nested objects/arrays so
   * nothing gets silently dropped or shown as a raw object.
   */
  flattenForDisplay(value: unknown, prefix = ''): DisplayEntry[] {
    if (Array.isArray(value)) {
      return value.flatMap((item, i) => this.flattenForDisplay(item, prefix ? `${prefix} ${i + 1}` : `Item ${i + 1}`));
    }
    if (value !== null && typeof value === 'object') {
      return Object.entries(value as Record<string, unknown>).flatMap(([key, v]) =>
        this.flattenForDisplay(v, prefix ? `${prefix} — ${this.humanizeKey(key)}` : this.humanizeKey(key)),
      );
    }
    return [{ label: prefix || 'Value', value: this.formatPrimitive(value) }];
  }

  /** A channel efficiency row's metrics, excluding whichever field was used as its display name so it isn't shown twice. */
  rowMetrics(row: Record<string, unknown>): DisplayEntry[] {
    const withoutName = { ...row };
    for (const key of CHANNEL_NAME_KEYS) delete withoutName[key];
    return this.flattenForDisplay(withoutName);
  }

  budgetEntries(results: TrainingResults): DisplayEntry[] {
    return results.budget_recommendation !== undefined ? this.flattenForDisplay(results.budget_recommendation) : [];
  }

  private static readonly KNOWN_RESULT_KEYS = new Set([
    'mock',
    'model_confidence',
    'channel_contribution',
    'channel_efficiency',
    'budget_recommendation',
  ]);

  /** Any result field not already covered by a dedicated section above - keeps this forward-compatible with fields not yet documented. */
  otherResultEntries(results: TrainingResults): DisplayEntry[] {
    return Object.entries(results)
      .filter(([key]) => !ProjectModels.KNOWN_RESULT_KEYS.has(key))
      .flatMap(([key, value]) => this.flattenForDisplay(value, this.humanizeKey(key)));
  }

  confirmDelete(row: ModelRow): void {
    this.deleteError.set(null);
    this.deleteTarget.set(row);
  }

  cancelDelete(): void {
    this.deleteTarget.set(null);
  }

  deleteModel(): void {
    const target = this.deleteTarget();
    if (!target || this.deleting()) return;
    this.deleting.set(true);
    this.deleteError.set(null);
    this.datasetService.remove(target.dataset.id).subscribe({
      next: () => {
        this.pollSubs.get(target.dataset.id)?.unsubscribe();
        this.pollSubs.delete(target.dataset.id);
        this.rows.update((list) => list.filter((r) => r.dataset.id !== target.dataset.id));
        this.deleting.set(false);
        this.deleteTarget.set(null);
      },
      error: (err: unknown) => {
        this.deleteError.set(backendErrorMessage(err, 'Could not delete this model.'));
        this.deleting.set(false);
      },
    });
  }

  /**
   * selectProject() (called in Upload Data's own ngOnInit) only clears the
   * previous dataset when the project actually changes - starting a new
   * model within this *same* project wouldn't otherwise clear whichever
   * dataset was last selected/edited here, so Upload Data would open
   * showing that other model's name/type and "already uploaded" notice
   * instead of a blank form. Clear both explicitly before navigating.
   */
  newModel(): void {
    this.tunnelService.clearDataset();
    this.uploadDraft.clearAll();
    this.router.navigate(['/upload-data', this.projectId()]);
  }

  /**
   * Resumes a row - the next incomplete step for a partial model, or
   * Configure (fully editable, every stage reloaded) for a finished one.
   * Same shared logic the Projects page's eye icon uses.
   */
  resume(row: ModelRow): void {
    this.router.navigate(resumeDatasetRoute(this.tunnelService, this.projectId(), row.dataset));
  }
}
