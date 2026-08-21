import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';

import { TunnelService } from '../services/tunnel.service';

/**
 * "Models" in the sidebar has no project of its own to point at - unlike
 * Results & Insights (results-projects.ts), which handles "no :projectId in
 * the URL" itself as a real two-mode component, /models/:projectId always
 * requires a real id. Same redirect rule as that component's own ngOnInit,
 * just run as a guard instead since ProjectModels isn't built to render a
 * picker itself: jump straight to whichever project is already active this
 * session (TunnelService, set by visiting Models/tunnel screens for it), or
 * fall back to the real Projects list to choose one first.
 */
export const modelsEntryGuard: CanActivateFn = () => {
  const tunnelService = inject(TunnelService);
  const router = inject(Router);

  const active = tunnelService.projectId();
  return router.createUrlTree(active ? ['/models', active] : ['/projects']);
};
