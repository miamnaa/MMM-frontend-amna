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
 * As of the real "projects are invite-only" backend change (2026-08-21),
 * GET /projects/:id itself already 404s for a project you have no access to
 * (owner, an added member, or a Master) - so existence alone is now the
 * right check here. This used to also require project.isMine, from when
 * the backend returned every tenant-wide project regardless of access; that
 * would now incorrectly block a project you were legitimately invited to
 * but don't own.
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
