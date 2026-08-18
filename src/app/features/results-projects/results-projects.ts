import { Component, OnInit, inject, signal } from '@angular/core';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';

import {
  ApiProjectDataset,
  DatasetService,
  isFailedTrainingStatus,
  isTerminalTrainingStatus,
} from '../../core/services/dataset.service';
import { Project } from '../../core/models/domain.models';
import { MODEL_STATUS_META, ModelStatus, computeModelStatus } from '../../core/services/model-status';
import { ProjectService } from '../../core/services/project.service';
import { TunnelService } from '../../core/services/tunnel.service';
import { EmptyState } from '../../shared/ui/empty-state/empty-state';
import { PageHeader } from '../../shared/ui/page-header/page-header';

type TrainedState = 'checking' | 'trained' | 'not-trained';

interface ModelRow {
  dataset: ApiProjectDataset;
  status: ModelStatus;
  label: string;
  trained: TrainedState;
}

/**
 * "Results & Insights" from the persistent sidebar. Two modes in one
 * component depending on whether :projectId is in the URL:
 * - no id: a project picker (real ProjectService.list())
 * - id present: that project's real trained models, "View Model" for any
 *   that have completed a real training run - GET /datasets/:id/status is
 *   checked per Ready model since neither listForProject() nor its cached
 *   row carries a persisted "was this trained" flag.
 */
@Component({
  selector: 'app-results-projects',
  imports: [RouterLink, PageHeader, EmptyState],
  templateUrl: './results-projects.html',
  styleUrl: './results-projects.css',
})
export class ResultsProjects implements OnInit {
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly projectService = inject(ProjectService);
  private readonly datasetService = inject(DatasetService);
  private readonly tunnelService = inject(TunnelService);

  readonly projectId = signal<string | null>(null);

  readonly projects = signal<Project[]>([]);
  readonly loadingProjects = signal(false);

  readonly project = signal<Project | null>(null);
  readonly rows = signal<ModelRow[]>([]);
  readonly loadingModels = signal(false);
  readonly loadError = signal<string | null>(null);

  ngOnInit(): void {
    const id = this.route.snapshot.paramMap.get('projectId');
    if (id) {
      this.projectId.set(id);
      this.loadModels(id);
      return;
    }

    // No project in the URL - jump straight to whichever project is
    // already active this session (TunnelService, set by visiting its
    // Models/tunnel screens) instead of always showing the picker first.
    const active = this.tunnelService.projectId();
    if (active) {
      this.router.navigate(['/results', active], { replaceUrl: true });
      return;
    }

    this.loadProjects();
  }

  private loadProjects(): void {
    this.loadingProjects.set(true);
    this.projectService.list().subscribe({
      next: (projects) => {
        this.projects.set(projects);
        this.loadingProjects.set(false);
      },
      error: () => this.loadingProjects.set(false),
    });
  }

  private loadModels(projectId: string): void {
    this.loadingModels.set(true);
    this.loadError.set(null);

    this.projectService.get(projectId).subscribe({
      next: (project) => this.project.set(project ?? null),
      error: () => {},
    });

    this.datasetService.listForProject(projectId).subscribe({
      next: (datasets) => {
        const rows: ModelRow[] = datasets.map((dataset) => {
          const status = computeModelStatus(dataset);
          return { dataset, status, label: MODEL_STATUS_META[status].label, trained: 'checking' as const };
        });
        this.rows.set(rows);
        this.loadingModels.set(false);
        rows.filter((r) => r.status === 'ready').forEach((r) => this.checkTrained(r.dataset.id));
      },
      error: () => {
        this.loadError.set("Could not load this project's models. Check your connection and try again.");
        this.loadingModels.set(false);
      },
    });
  }

  /** A model reaching "Ready" only means every setup step is saved, not that a real training run has ever completed - checked separately since there's no persisted flag for that. */
  private checkTrained(datasetId: string): void {
    this.datasetService.getTrainingStatus(datasetId).subscribe({
      next: (res) => {
        const trained: TrainedState =
          isTerminalTrainingStatus(res.status) && !isFailedTrainingStatus(res.status) ? 'trained' : 'not-trained';
        this.updateTrained(datasetId, trained);
      },
      error: () => this.updateTrained(datasetId, 'not-trained'),
    });
  }

  private updateTrained(datasetId: string, trained: TrainedState): void {
    this.rows.update((list) => list.map((r) => (r.dataset.id === datasetId ? { ...r, trained } : r)));
  }
}
