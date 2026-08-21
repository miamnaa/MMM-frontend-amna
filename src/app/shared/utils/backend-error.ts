import { HttpErrorResponse } from '@angular/common/http';

/**
 * The backend's error body always has a `message` - a string for most
 * failures, an array of strings for validation errors (API-REFERENCE.md,
 * "Response conventions"). Prefer that real message over a generic
 * fallback whenever it's there. Same logic already duplicated in
 * projects.ts and otp.service.ts - pulled out here since the four new
 * model-creation screens (Configure/Optimize/Calibrate/Hyperparameters)
 * all need it too.
 *
 * `err.error` is normally the already-parsed JSON body - but Angular only
 * parses it when the response's Content-Type header actually says
 * application/json. If the backend ever sends a real error body as plain
 * text (wrong/missing content-type on its end), `err.error` comes through
 * as a raw string instead of an object, and `err.error?.message` would
 * silently miss it - falling through to the generic fallback even though
 * the real message was right there. Parsing that string as JSON first
 * covers that case too, cheaply, without assuming it'll ever happen.
 */
export function backendErrorMessage(err: unknown, fallback: string): string {
  if (err instanceof HttpErrorResponse) {
    let body: unknown = err.error;
    if (typeof body === 'string') {
      try {
        body = JSON.parse(body);
      } catch {
        // Not JSON - fall through to the generic fallback below.
      }
    }
    const message = (body as { message?: unknown } | null)?.message;
    if (typeof message === 'string' && message.trim().length > 0) return message;
    if (Array.isArray(message)) return message.join(' ');
  }
  return fallback;
}
