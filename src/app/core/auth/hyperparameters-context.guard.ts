import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';

import { TunnelService } from '../services/tunnel.service';

/**
 * Same dataset-id check as datasetContextGuard, plus Calibration must have
 * actually been saved first. This is also what guarantees the channel list
 * on Hyperparameters always has real, saved mediaColumns to pre-fill from -
 * you cannot reach this screen without Configure having been saved.
 */
export const hyperparametersContextGuard: CanActivateFn = (route) => {
  const tunnelService = inject(TunnelService);
  const router = inject(Router);
  const projectId = route.paramMap.get('projectId');
  const datasetId = route.paramMap.get('datasetId');

  const contextMatches =
    projectId !== null &&
    datasetId !== null &&
    tunnelService.projectId() === projectId &&
    tunnelService.dataset()?.id === datasetId &&
    tunnelService.calibration() !== null;

  return contextMatches ? true : router.createUrlTree(['/projects']);
};
