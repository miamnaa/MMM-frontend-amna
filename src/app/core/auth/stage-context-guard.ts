import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { catchError, map, of } from 'rxjs';

import { DatasetService } from '../services/dataset.service';
import { ModelStatus, computeModelStatus, loadDatasetIntoTunnel } from '../services/model-status';
import { TunnelService } from '../services/tunnel.service';

/** What must already be true, in TunnelService's own terms, to reach each tunnel screen. */
type RequiredStage = 'dataset' | 'configuration' | 'optimize' | 'calibration';

const STATUS_RANK: Record<ModelStatus, number> = {
  uploaded: 0,
  configured: 1,
  optimized: 2,
  calibrated: 3,
  ready: 4,
};

const MIN_RANK: Record<RequiredStage, number> = {
  dataset: 0,
  configuration: 1,
  optimize: 2,
  calibration: 3,
};

/**
 * Configure/Optimize/Calibrate/Hyperparameters have no real "am I done" read
 * endpoint to check a single field against, so each one's guard was built
 * around TunnelService's in-memory state - which meant a plain page reload
 * (a fresh tab, in-memory state starts empty) bounced straight to /projects
 * even though the dataset's progress was real and saved on the backend the
 * whole time. Fixed by falling back to the one real endpoint that does
 * exist - listForProject() - and reconstructing TunnelService from it,
 * rather than trusting only what happened to survive in this tab's memory.
 */
export function createStageGuard(requiredStage: RequiredStage): CanActivateFn {
  return (route) => {
    const tunnelService = inject(TunnelService);
    const datasetService = inject(DatasetService);
    const router = inject(Router);
    const projectId = route.paramMap.get('projectId');
    const datasetId = route.paramMap.get('datasetId');
    const toProjects = () => router.createUrlTree(['/projects']);

    if (!projectId || !datasetId) return toProjects();

    const stageMet = (): boolean => {
      if (requiredStage === 'dataset') return true;
      if (requiredStage === 'configuration') return tunnelService.configuration() !== null;
      if (requiredStage === 'optimize') return tunnelService.optimize() !== null;
      return tunnelService.calibration() !== null;
    };

    const sameDataset = tunnelService.projectId() === projectId && tunnelService.dataset()?.id === datasetId;
    if (sameDataset && stageMet()) return of(true);

    // Reload / direct-hit fallback - re-fetch the real dataset and rebuild
    // TunnelService from its persisted fields instead of assuming this
    // tab's empty in-memory state means the work never happened.
    return datasetService.listForProject(projectId).pipe(
      map((datasets) => {
        const dataset = datasets.find((d) => d.id === datasetId);
        if (!dataset) return toProjects();

        const rank = STATUS_RANK[computeModelStatus(dataset)];
        if (rank < MIN_RANK[requiredStage]) return toProjects();

        loadDatasetIntoTunnel(tunnelService, projectId, dataset);
        return true;
      }),
      catchError(() => of(toProjects())),
    );
  };
}
