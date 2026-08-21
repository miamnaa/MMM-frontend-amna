import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { map, of, catchError } from 'rxjs';

import { ProjectService } from '../services/project.service';

/**
 * Upload Data is the one tunnel step checked against the real backend, not
 * just in-memory state - Projects is a real API today, so a direct hit on
 * /upload-data/:projectId (typed URL, bookmark, refresh) still gets
 * validated properly instead of trusting whatever's in the address bar.
 *
 * Also checks real ownership (isMine), not just existence - the backend
 * returns every tenant-wide project from GET /projects/:id (including ones
 * you don't own, which is why training itself real-403s with "Only the
 * project owner can do this."), so without this check a stale session, a
 * bookmark, or a shared link could land you on someone else's project's
 * Models page. Every screen behind this guard (Models, Upload Data,
 * Configure, Optimize, ...) should only ever show what the signed-in
 * account actually owns.
 */
export const projectContextGuard: CanActivateFn = (route) => {
  const projectService = inject(ProjectService);
  const router = inject(Router);
  const projectId = route.paramMap.get('projectId');

  if (!projectId) return router.createUrlTree(['/projects']);

  return projectService.get(projectId).pipe(
    map((project) => (project?.isMine ? true : router.createUrlTree(['/projects']))),
    catchError(() => of(router.createUrlTree(['/projects']))),
  );
};
