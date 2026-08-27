import { Component, OnDestroy, OnInit, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { Subscription, interval } from 'rxjs';
import { switchMap, takeWhile } from 'rxjs/operators';

import {
  ApiProjectDataset,
  DatasetService,
  isFailedTrainingStatus,
  isNotStartedTrainingStatus,
  isTerminalTrainingStatus,
} from '../../core/services/dataset.service';
import { Project } from '../../core/models/domain.models';
import { ApiMember } from '../../core/services/members.service';
import { MODEL_STATUS_META, ModelStatus, computeModelStatus, resumeDatasetRoute } from '../../core/services/model-status';
import { SessionService } from '../../core/services/notification.service';
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
 * (POST .../train, GET .../status polled every 3s until a terminal state).
 * 'checking' only ever happens once, right after load(), while re-checking
 * a Ready dataset's real training status - "Ready" only means setup is
 * saved, not that a real training run has ever completed, and there's no
 * persisted flag for that beyond asking the status endpoint directly.
 * 'completed' no longer carries the results payload - "View Model" routes
 * to a dedicated results page that fetches its own real GET .../results.
 */
type TrainState =
  | { phase: 'idle' }
  | { phase: 'checking' }
  | { phase: 'starting' }
  | {
      phase: 'training';
      progress?: number;
      message?: string;
      stepNumber?: number;
      totalSteps?: number;
      stepLabel?: string;
    }
  | { phase: 'completed' }
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
  imports: [FormsModule, RouterLink, PageHeader, EmptyState],
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
  private readonly session = inject(SessionService);

  /** Real 'read' role can view this page but every create/train/delete endpoint here real-403s for it - gates + New model, Train Model, and Delete. */
  readonly isReadOnly = this.session.isReadOnly;

  readonly projectId = signal('');
  readonly project = signal<Project | null>(null);
  readonly rows = signal<ModelRow[]>([]);
  readonly loading = signal(true);
  readonly loadError = signal<string | null>(null);

  /** Every real project, for the sidebar-adjacent "Select project" dropdown - lets you switch without going back through /projects. */
  readonly projectOptions = signal<Project[]>([]);

  /** This project's real members, to resolve each dataset's real createdByUserId into a name for "Uploaded by" instead of a raw id. */
  readonly members = signal<ApiMember[]>([]);

  readonly deleteTarget = signal<ModelRow | null>(null);
  readonly deleting = signal(false);
  readonly deleteError = signal<string | null>(null);

  /** One poll subscription per dataset currently training - cleaned up on delete and on leaving this screen. */
  private readonly pollSubs = new Map<string, Subscription>();

  ngOnInit(): void {
    this.projectId.set(this.route.snapshot.paramMap.get('projectId') ?? '');
    // So "Results & Insights" in the sidebar (reached with no :projectId of
    // its own) knows which project to jump into - just viewing this page
    // marks it as the active one for the session, same as Edit/Continue
    // Setup already does via resume().
    this.tunnelService.selectProject(this.projectId());
    this.load();
    this.loadProjectOptions();
    this.loadMembers();
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
        const rows: ModelRow[] = datasets.map((dataset) => {
          const status = computeModelStatus(dataset);
          return { dataset, status, ...MODEL_STATUS_META[status], training: { phase: 'idle' as const } };
        });
        this.rows.set(rows);
        this.loading.set(false);
        rows.filter((r) => r.status === 'ready').forEach((r) => this.checkExistingTraining(r.dataset.id));
      },
      error: () => {
        this.loadError.set("Could not load this project's models. Check your connection and try again.");
        this.loading.set(false);
      },
    });
  }

  /**
   * A model reaching "Ready" only means every setup step is saved - it
   * doesn't mean a real training run has ever completed for it. Checked
   * once per Ready row on load so "View Model" (and a resumed poll for one
   * still running) shows up correctly even after a page reload, not only
   * within the session that actually started training.
   */
  private checkExistingTraining(id: string): void {
    this.updateTraining(id, { phase: 'checking' });
    this.datasetService.getTrainingStatus(id).subscribe({
      next: (res) => {
        // Checked first, deliberately: "not_started" is the real, permanent
        // resting status for a Ready dataset that's never been trained - it's
        // not terminal, but treating it as "still running" is what produced
        // the old bug (a fake "Training… 0%" pill, stuck forever, with no
        // real Train Model button to click).
        if (isNotStartedTrainingStatus(res.status)) {
          this.updateTraining(id, { phase: 'idle' });
          return;
        }
        if (!isTerminalTrainingStatus(res.status)) {
          this.updateTraining(id, this.toTrainingState(res));
          this.pollTraining(id);
          return;
        }
        if (isFailedTrainingStatus(res.status)) {
          this.updateTraining(id, { phase: 'failed', error: res.errorMessage ?? res.message ?? 'Training failed.' });
          return;
        }
        this.updateTraining(id, { phase: 'completed' });
      },
      // No status row exists yet at all for this dataset - a separate case
      // from the real "not_started" status above, but the same fallback.
      error: () => this.updateTraining(id, { phase: 'idle' }),
    });
  }

  private updateTraining(datasetId: string, training: TrainState): void {
    this.rows.update((list) => list.map((r) => (r.dataset.id === datasetId ? { ...r, training } : r)));
  }

  /**
   * Real /status returns progress as a 0-1 fraction (confirmed live -
   * "0.3" and "0.8" were real training runs at 30% and 80%, not 0.3% and
   * 0.8%), not the 0-100 percent this was originally assumed to already
   * be. Every caller that stores progress into TrainState goes through
   * this so "30%"/"80%" always means what it says, in one place.
   */
  private toPercent(fraction: number | undefined): number | undefined {
    return fraction === undefined ? undefined : Math.round(fraction * 100);
  }

  /**
   * Real change from Anas: `stepNumber`/`totalSteps`/`stepLabel` name which
   * of the 7 fixed real pipeline steps is running (e.g. "Building the model
   * configuration"), so the UI can read "Step 3 of 7: ..." instead of the
   * confusing raw ".3%" `progress` alone produced. All three are optional -
   * absent on "not_started" or during a transient network hiccup reaching
   * the engine - so this only ever adds them when the backend actually sent
   * them, never guesses.
   */
  private toTrainingState(res: {
    progress?: number;
    message?: string;
    stepNumber?: number;
    totalSteps?: number;
    stepLabel?: string;
  }): TrainState {
    return {
      phase: 'training',
      progress: this.toPercent(res.progress),
      message: res.message,
      stepNumber: res.stepNumber,
      totalSteps: res.totalSteps,
      stepLabel: res.stepLabel,
    };
  }

  /** Real POST .../train, then polls the real .../status endpoint every 3s until it reaches a terminal state. */
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
            this.updateTraining(id, this.toTrainingState(res));
            return;
          }
          if (isFailedTrainingStatus(res.status)) {
            this.updateTraining(id, { phase: 'failed', error: res.errorMessage ?? res.message ?? 'Training failed.' });
            return;
          }
          this.updateTraining(id, { phase: 'completed' });
        },
        error: (err: unknown) => {
          this.updateTraining(id, { phase: 'failed', error: backendErrorMessage(err, 'Lost track of this training run. Try again.') });
        },
      });

    this.pollSubs.set(id, sub);
  }

  /**
   * "Configuration" only describes the 4 setup steps (Configure/Optimize/
   * Calibrate/Hyperparameters) - once a model reaches Ready, that's over and
   * done with, so the same top bar switches to reporting real training
   * progress instead. Before this, a Ready row always showed a green
   * "100% Configuration" bar no matter what training was actually doing
   * underneath it - real, stuck, or failed all looked identical and done.
   */
  progressLabel(row: ModelRow): string {
    return row.status === 'ready' ? 'Training' : 'Configuration';
  }

  progressPercent(row: ModelRow): number {
    if (row.status !== 'ready') return row.percent;
    const t = row.training;
    return t.phase === 'training' ? (t.progress ?? 0) : t.phase === 'completed' ? 100 : 0;
  }

  /** "Step 3 of 7: Building the model configuration" - null until the backend actually sends the 3 step fields (not_started, or a transient hiccup reaching the engine). */
  stepText(row: ModelRow): string | null {
    const t = row.training;
    if (t.phase !== 'training' || !t.stepNumber || !t.totalSteps || !t.stepLabel) return null;
    return `Step ${t.stepNumber} of ${t.totalSteps}: ${t.stepLabel}`;
  }

  /** Ticks for the 7-step segmented bar - filled up to and including the current step. Only meaningful once stepText() is non-null. */
  stepTicks(row: ModelRow): boolean[] {
    const t = row.training;
    if (t.phase !== 'training' || !t.totalSteps) return [];
    return Array.from({ length: t.totalSteps }, (_, i) => i < (t.stepNumber ?? 0));
  }

  /** True for the single tick that's actively running right now, so it can pulse instead of sitting static (reading as "in progress," not stuck). */
  isCurrentStep(row: ModelRow, index: number): boolean {
    const t = row.training;
    return t.phase === 'training' && index + 1 === t.stepNumber;
  }

  private loadProjectOptions(): void {
    this.projectService.list().subscribe({
      next: (projects) => this.projectOptions.set(projects),
      error: () => {},
    });
  }

  private loadMembers(): void {
    this.projectService.listMembers(this.projectId()).subscribe({
      next: (members) => this.members.set(members),
      error: () => {},
    });
  }

  /** "Uploaded by [name]" per dataset, resolved against this project's real member list - falls back to nothing shown if the uploader isn't (or is no longer) a member with access to this project. */
  uploaderName(row: ModelRow): string | null {
    const id = row.dataset.createdByUserId;
    if (!id) return null;
    const member = this.members().find((m) => m.id === id);
    return member ? `${member.firstName} ${member.lastName}`.trim() : null;
  }

  selectProject(id: string): void {
    if (!id || id === this.projectId()) return;
    this.router.navigate(['/models', id]);
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
