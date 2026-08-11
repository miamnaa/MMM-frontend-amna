import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { map, of, catchError } from 'rxjs';

import { ProjectService } from '../services/project.service';

/**
 * Upload Data is the one tunnel step checked against the real backend, not
 * just in-memory state - Projects is a real API today, so a direct hit on
 * /upload-data/:projectId (typed URL, bookmark, refresh) still gets
 * validated properly instead of trusting whatever's in the address bar.
 */
export const projectContextGuard: CanActivateFn = (route) => {
  const projectService = inject(ProjectService);
  const router = inject(Router);
  const projectId = route.paramMap.get('projectId');

  if (!projectId) return router.createUrlTree(['/projects']);

  return projectService.get(projectId).pipe(
    map((project) => (project ? true : router.createUrlTree(['/projects']))),
    catchError(() => of(router.createUrlTree(['/projects']))),
  );
};
