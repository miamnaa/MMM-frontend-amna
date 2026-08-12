import { HttpErrorResponse } from '@angular/common/http';

/**
 * The backend's error body always has a `message` - a string for most
 * failures, an array of strings for validation errors (API-REFERENCE.md,
 * "Response conventions"). Prefer that real message over a generic
 * fallback whenever it's there. Same logic already duplicated in
 * projects.ts and otp.service.ts - pulled out here since the four new
 * model-creation screens (Configure/Optimize/Calibrate/Hyperparameters)
 * all need it too.
 */
export function backendErrorMessage(err: unknown, fallback: string): string {
  if (err instanceof HttpErrorResponse) {
    const message: unknown = err.error?.message;
    if (typeof message === 'string') return message;
    if (Array.isArray(message)) return message.join(' ');
  }
  return fallback;
}
