import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { Injectable, inject, signal } from '@angular/core';

import { environment } from '../../../environments/environment';

const VERIFIED_KEY = 'otp_verified';

/**
 * The real /auth/otp endpoints (see requirements 2026-08-11). Both require a
 * valid Entra bearer token - MsalInterceptor already attaches it to any call
 * matching apiBaseUrl/*, same as ProjectService, so no extra wiring here.
 */
@Injectable({ providedIn: 'root' })
export class OtpService {
  private readonly http = inject(HttpClient);
  private readonly url = `${environment.apiBaseUrl}/auth/otp`;

  /**
   * sessionStorage, not a plain signal - survives a page refresh (the token
   * cache does too, via localStorage) but resets when the tab/window
   * closes, so a brand new browser session always asks again.
   */
  readonly verified = signal<boolean>(sessionStorage.getItem(VERIFIED_KEY) === 'true');

  readonly requesting = signal(false);
  readonly verifying = signal(false);
  readonly requestError = signal<string | null>(null);
  readonly verifyError = signal<string | null>(null);
  /** Set once a request call actually succeeds, so the screen can say "code sent". */
  readonly codeSent = signal(false);

  requestCode(): void {
    if (this.requesting()) return;
    this.requesting.set(true);
    this.requestError.set(null);

    this.http.post<void>(`${this.url}/request`, {}).subscribe({
      next: () => {
        this.requesting.set(false);
        this.codeSent.set(true);
      },
      error: (err: unknown) => {
        this.requesting.set(false);
        this.codeSent.set(false);
        this.requestError.set(this.requestErrorMessage(err));
      },
    });
  }

  verifyCode(code: string): void {
    if (this.verifying()) return;
    this.verifying.set(true);
    this.verifyError.set(null);

    this.http.post<void>(`${this.url}/verify`, { code }).subscribe({
      next: () => {
        this.verifying.set(false);
        this.verified.set(true);
        sessionStorage.setItem(VERIFIED_KEY, 'true');
      },
      error: (err: unknown) => {
        this.verifying.set(false);
        this.verifyError.set(this.verifyErrorMessage(err));
      },
    });
  }

  clear(): void {
    this.verified.set(false);
    this.codeSent.set(false);
    this.requestError.set(null);
    this.verifyError.set(null);
    sessionStorage.removeItem(VERIFIED_KEY);
  }

  /**
   * Sending mail depends on a Microsoft Graph permission grant that's
   * pending as of 2026-08-11 - a 500 here is a known, expected state until
   * that's granted, not a bug, so it gets its own message rather than
   * reading as a generic failure.
   */
  private requestErrorMessage(err: unknown): string {
    if (err instanceof HttpErrorResponse && err.status === 500) {
      return "Couldn't send the code right now — email delivery isn't fully set up yet. Try again shortly.";
    }
    return this.backendMessage(err, 'Could not send a verification code. Try again.');
  }

  private verifyErrorMessage(err: unknown): string {
    if (err instanceof HttpErrorResponse) {
      if (err.status === 404) return 'No code was requested yet. Tap "Resend code" and try again.';
      if (err.status === 401) return this.backendMessage(err, "That code didn't work — it may be wrong, expired, or you've tried too many times.");
    }
    return this.backendMessage(err, 'Could not verify that code. Try again.');
  }

  /** Same "message" shape as the rest of the API (API-REFERENCE.md, "Response conventions"). */
  private backendMessage(err: unknown, fallback: string): string {
    if (err instanceof HttpErrorResponse) {
      const message: unknown = err.error?.message;
      if (typeof message === 'string') return message;
      if (Array.isArray(message)) return message.join(' ');
    }
    return fallback;
  }
}
