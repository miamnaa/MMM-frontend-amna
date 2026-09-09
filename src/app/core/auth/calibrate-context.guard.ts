import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { catchError, map, of } from 'rxjs';

import { DatasetService } from '../services/dataset.service';
import { computeModelStatus, loadDatasetIntoTunnel } from '../services/model-status';
import { TunnelService } from '../services/tunnel.service';

/**
 * Calibrate requires Optimize to have actually been saved first - same
 * real rule every other stage guard uses (see stage-context-guard.ts).
 *
 * On top of that: real, confirmed 2026-09-09 by reading PyMC's own real
 * pipeline source directly (pymc_run_pipeline.py, pymc_calibrate.py,
 * pymc_budget_allocation.py) - Calibrate's fields
 * (contribution_belief_percent/confidence_percent) are never read
 * anywhere in PyMC's real code, only Meridian uses them, and the backend
 * already stopped sending calibration to PyMC at all. Anas's explicit
 * call: a step that isn't usable isn't an option - not a disabled state,
 * not a note, not shown at all. A PyMC dataset is redirected straight to
 * Hyperparameterization instead of this screen ever rendering.
 */
export const calibrateContextGuard: CanActivateFn = (route) => {
  const tunnelService = inject(TunnelService);
  const datasetService = inject(DatasetService);
  const router = inject(Router);
  const projectId = route.paramMap.get('projectId');
  const datasetId = route.paramMap.get('datasetId');
  const toProjects = () => router.createUrlTree(['/projects']);
  const toHyperparameters = () => router.createUrlTree(['/hyperparameters', projectId!, datasetId!]);

  if (!projectId || !datasetId) return toProjects();

  const sameDataset = tunnelService.projectId() === projectId && tunnelService.dataset()?.id === datasetId;
  if (sameDataset) {
    if (tunnelService.dataset()?.modelType === 'pymc') return toHyperparameters();
    return tunnelService.optimize() !== null ? of(true) : toProjects();
  }

  // Reload / direct-hit fallback - re-fetch the real dataset and rebuild
  // TunnelService from its persisted fields instead of assuming this
  // tab's empty in-memory state means the work never happened.
  return datasetService.listForProject(projectId).pipe(
    map((datasets) => {
      const dataset = datasets.find((d) => d.id === datasetId);
      if (!dataset) return toProjects();
      if (computeModelStatus(dataset) !== 'ready') return toProjects();

      loadDatasetIntoTunnel(tunnelService, projectId, dataset);
      return dataset.modelType === 'pymc' ? toHyperparameters() : true;
    }),
    catchError(() => of(toProjects())),
  );
};
