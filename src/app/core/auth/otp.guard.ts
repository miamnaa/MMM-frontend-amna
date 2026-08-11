import { inject } from '@angular/core';
import { CanActivateChildFn, Router } from '@angular/router';

import { OtpService } from '../services/otp.service';

/**
 * Runs alongside MsalGuard on the main layout's canActivateChild - MsalGuard
 * only proves "signed into Microsoft", this proves "and completed the email
 * code step too". Anyone who hasn't gets bounced to /verify instead of
 * whatever dashboard page they tried to reach directly.
 */
export const otpGuard: CanActivateChildFn = () => {
  const otpService = inject(OtpService);
  const router = inject(Router);

  if (otpService.verified()) return true;

  return router.createUrlTree(['/verify']);
};
