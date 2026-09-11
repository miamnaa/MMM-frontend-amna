import { inject } from '@angular/core';
import { CanActivateChildFn, Router } from '@angular/router';

import { OtpService } from '../services/otp.service';

/**
 * Runs alongside MsalGuard on the main layout's canActivateChild - MsalGuard
 * only proves "signed into Microsoft", this proves "and completed the email
 * code step too". Anyone who hasn't gets bounced to /verify instead of
 * whatever dashboard page they tried to reach directly.
 *
 * Real bug, fixed 2026-09-11: the deep link being requested (e.g. a
 * specific tunnel step) was dropped on the floor here - Verify always sent
 * everyone to /projects afterwards regardless of what they were actually
 * trying to reach, which read as "my progress didn't save" even when it
 * genuinely had. `state.url` (the real destination this guard is currently
 * blocking) rides along as `returnUrl` so Verify can send them back to it.
 */
export const otpGuard: CanActivateChildFn = (childRoute, state) => {
  const otpService = inject(OtpService);
  const router = inject(Router);

  if (otpService.verified()) return true;

  return router.createUrlTree(['/verify'], { queryParams: { returnUrl: state.url } });
};
