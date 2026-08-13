import { Component, OnInit, inject, signal } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';

import { ApiProjectDataset, DatasetService } from '../../core/services/dataset.service';
import { Project } from '../../core/models/domain.models';
import { MODEL_STATUS_META, ModelStatus, computeModelStatus, resumeDatasetRoute } from '../../core/services/model-status';
import { ProjectService } from '../../core/services/project.service';
import { TunnelService } from '../../core/services/tunnel.service';
import { EmptyState } from '../../shared/ui/empty-state/empty-state';
import { PageHeader } from '../../shared/ui/page-header/page-header';
import { backendErrorMessage } from '../../shared/utils/backend-error';

interface ModelRow {
  dataset: ApiProjectDataset;
  status: ModelStatus;
  label: string;
  percent: number;
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
export class ProjectModels implements OnInit {
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly projectService = inject(ProjectService);
  private readonly datasetService = inject(DatasetService);
  private readonly tunnelService = inject(TunnelService);

  readonly projectId = signal('');
  readonly project = signal<Project | null>(null);
  readonly rows = signal<ModelRow[]>([]);
  readonly loading = signal(true);
  readonly loadError = signal<string | null>(null);

  readonly deleteTarget = signal<ModelRow | null>(null);
  readonly deleting = signal(false);
  readonly deleteError = signal<string | null>(null);

  ngOnInit(): void {
    this.projectId.set(this.route.snapshot.paramMap.get('projectId') ?? '');
    this.load();
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
            return { dataset, status, ...MODEL_STATUS_META[status] };
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

  newModel(): void {
    this.router.navigate(['/upload-data', this.projectId()]);
  }

  /** The only way back to the Project list now that neither page shows the left Sidebar. */
  backToProjects(): void {
    this.router.navigate(['/projects']);
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
