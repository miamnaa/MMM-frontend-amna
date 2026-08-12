import { Component, OnInit, inject, signal } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { MsalService } from '@azure/msal-angular';

import { localSignOut } from '../../core/auth/local-sign-out';
import { ApiProjectDataset, DatasetService } from '../../core/services/dataset.service';
import { Project } from '../../core/models/domain.models';
import { ProjectService } from '../../core/services/project.service';
import { TunnelService } from '../../core/services/tunnel.service';
import { EmptyState } from '../../shared/ui/empty-state/empty-state';
import { PageHeader } from '../../shared/ui/page-header/page-header';

type ModelStatus = 'uploaded' | 'configured' | 'optimized' | 'calibrated' | 'ready';

interface ModelRow {
  dataset: ApiProjectDataset;
  status: ModelStatus;
  label: string;
  percent: number;
}

const STATUS_META: Record<ModelStatus, { label: string; percent: number }> = {
  uploaded: { label: 'Uploaded', percent: 20 },
  configured: { label: 'Configured', percent: 40 },
  optimized: { label: 'Optimized', percent: 60 },
  calibrated: { label: 'Calibrated', percent: 80 },
  ready: { label: 'Ready', percent: 100 },
};

/** Status is computed purely from presence (null vs. not) - see ApiProjectDataset for what's assumed about the shape. */
function computeStatus(d: ApiProjectDataset): ModelStatus {
  if (d.columnMapping === null) return 'uploaded';
  if (d.dateRange === null) return 'configured';
  if (d.calibration === null) return 'optimized';
  if (d.channelHyperparameters === null) return 'calibrated';
  return 'ready';
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
  private readonly msalService = inject(MsalService);

  readonly projectId = signal('');
  readonly project = signal<Project | null>(null);
  readonly rows = signal<ModelRow[]>([]);
  readonly loading = signal(true);
  readonly loadError = signal<string | null>(null);

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
            const status = computeStatus(dataset);
            return { dataset, status, ...STATUS_META[status] };
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

  back(): void {
    this.router.navigate(['/projects']);
  }

  /** See local-sign-out.ts - same call used everywhere else in the tunnel. */
  signOut(): void {
    void localSignOut(this.msalService);
  }

  newModel(): void {
    this.router.navigate(['/upload-data', this.projectId()]);
  }

  /**
   * Resumes a partially-configured dataset. Route guards check in-memory
   * TunnelService state, built for a single linear session - this
   * reconstructs that state from the real, persisted fields this row's
   * dataset already carries, before navigating, otherwise the destination
   * screen's guard would bounce straight back to /projects. columnMapping's
   * exact shape is assumed to mirror saveConfiguration()'s body exactly
   * (see ApiProjectDataset) - unverified beyond that assumption.
   */
  continueSetup(row: ModelRow): void {
    const { dataset, status } = row;
    this.tunnelService.selectProject(this.projectId());
    this.tunnelService.setDataset({
      id: dataset.id,
      name: dataset.name,
      modelType: dataset.modelType ?? '',
      local: false,
    });

    if (status === 'uploaded') {
      this.router.navigate(['/configure', this.projectId(), dataset.id]);
      return;
    }
    if (dataset.columnMapping) this.tunnelService.setConfiguration(dataset.columnMapping);

    if (status === 'configured') {
      this.router.navigate(['/optimize', this.projectId(), dataset.id]);
      return;
    }
    if (dataset.dateRange) this.tunnelService.setOptimize(dataset.dateRange);

    if (status === 'optimized') {
      this.router.navigate(['/calibrate', this.projectId(), dataset.id]);
      return;
    }
    if (dataset.calibration) this.tunnelService.setCalibration(dataset.calibration);

    // Only 'calibrated' remains here - 'ready' never calls continueSetup (see the template's Train Model branch).
    this.router.navigate(['/hyperparameters', this.projectId(), dataset.id]);
  }
}
