import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';

import { TunnelService } from '../services/tunnel.service';

/** Same dataset-id check as datasetContextGuard, plus Configure must have actually been saved first. */
export const optimizeContextGuard: CanActivateFn = (route) => {
  const tunnelService = inject(TunnelService);
  const router = inject(Router);
  const projectId = route.paramMap.get('projectId');
  const datasetId = route.paramMap.get('datasetId');

  const contextMatches =
    projectId !== null &&
    datasetId !== null &&
    tunnelService.projectId() === projectId &&
    tunnelService.dataset()?.id === datasetId &&
    tunnelService.configuration() !== null;

  return contextMatches ? true : router.createUrlTree(['/projects']);
};
