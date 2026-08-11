import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';

import { TunnelService } from '../services/tunnel.service';

/**
 * Configure has no real backend yet (CMP-79), so this can only check the
 * in-memory TunnelService, not a real dataset record - meaning it resets on
 * a fresh tab. That's an accepted tradeoff for a step that's genuinely
 * mock/local for now, not a security gate like otpGuard.
 */
export const datasetContextGuard: CanActivateFn = (route) => {
  const tunnelService = inject(TunnelService);
  const router = inject(Router);
  const projectId = route.paramMap.get('projectId');

  const contextMatches = projectId !== null && tunnelService.projectId() === projectId && tunnelService.dataset() !== null;

  return contextMatches ? true : router.createUrlTree(['/projects']);
};
