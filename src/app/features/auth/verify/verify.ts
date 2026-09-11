import { Component, DestroyRef, OnInit, computed, effect, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';

import { OtpService } from '../../../core/services/otp.service';
import { Logo } from '../../../shared/ui/logo/logo';

/**
 * The email-code second factor, required after Microsoft sign-in and before
 * the dashboard (see otp.guard.ts).
 *
 * requestCode() is called from exactly two places in this whole app -
 * ngOnInit below (first arrival) and resend() (an explicit click). Verified
 * 2026-09-11 while investigating a report that the real 5-attempt limit
 * never seemed to trigger live: there is no re-render, remount, or
 * background refetch anywhere in this file or otp.service.ts that calls it
 * again on its own - a fresh code (and the real attempt counter resetting
 * to 0 with it) only ever happens here on an actual new page load of this
 * route or a genuine Resend click, never silently. If the 5-try limit is
 * still not triggering live, the next place to look is whatever caused the
 * page to reload while already on this screen (a full MSAL redirect from a
 * mid-page silent token refresh is the one candidate this app's own
 * interceptor config could realistically produce), not this component.
 */
@Component({
  selector: 'app-verify',
  imports: [FormsModule, Logo],
  templateUrl: './verify.html',
  styleUrl: './verify.css',
})
export class Verify implements OnInit {
  private readonly otpService = inject(OtpService);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);
  private readonly destroyRef = inject(DestroyRef);

  readonly requesting = this.otpService.requesting;
  readonly verifying = this.otpService.verifying;
  readonly requestError = this.otpService.requestError;
  readonly verifyError = this.otpService.verifyError;
  readonly codeSent = this.otpService.codeSent;
  readonly attemptsRemaining = this.otpService.attemptsRemaining;
  readonly lockedOut = this.otpService.lockedOut;

  readonly code = signal('');

  /** Ticks once a second only so expiresInLabel below stays live - not read anywhere else. */
  private readonly nowTick = signal(Date.now());

  /** Real 10-minute window (see otp.service.ts's codeExpiresAt), not a guess - null until a code has actually been sent. */
  readonly expiresInLabel = computed(() => {
    const expiresAt = this.otpService.codeExpiresAt();
    if (expiresAt === null) return null;
    const msLeft = expiresAt - this.nowTick();
    if (msLeft <= 0) return 'This code has expired — tap "Resend code" for a new one.';
    const minutes = Math.floor(msLeft / 60000);
    const seconds = Math.floor((msLeft % 60000) / 1000);
    return `Code expires in ${minutes}:${seconds.toString().padStart(2, '0')}`;
  });

  ngOnInit(): void {
    // Fire the first code automatically - the user shouldn't have to click
    // anything just to get the email moving.
    this.otpService.requestCode();

    const intervalId = setInterval(() => this.nowTick.set(Date.now()), 1000);
    this.destroyRef.onDestroy(() => clearInterval(intervalId));
  }

  onCodeInput(value: string): void {
    // Digits only, capped at 6 - matches the backend's fixed-length code.
    this.code.set(value.replace(/\D/g, '').slice(0, 6));
  }

  resend(): void {
    this.otpService.requestCode();
  }

  submit(): void {
    if (this.code().length !== 6 || this.verifying() || this.lockedOut()) return;
    this.otpService.verifyCode(this.code());
  }

  /**
   * Real fix, 2026-09-11: used to always land on /projects regardless of
   * where the otpGuard redirect actually came from, which dropped anyone
   * mid-tunnel (e.g. Calibrate) back to square one after re-verifying -
   * looked exactly like lost progress even though nothing was. Only trusts
   * a same-origin, in-app path (starts with a single '/', never '//' -
   * that's protocol-relative and would leave the app) - otherwise falls
   * back to /projects same as before.
   */
  private safeReturnUrl(): string | null {
    const raw = this.route.snapshot.queryParamMap.get('returnUrl');
    if (raw && raw.startsWith('/') && !raw.startsWith('//')) return raw;
    return null;
  }

  constructor() {
    // Move on the moment the service confirms verification - back to
    // whatever the user was actually trying to reach, or the tunnel's
    // project list if there's nothing real to return to.
    effect(() => {
      if (this.otpService.verified()) {
        this.router.navigateByUrl(this.safeReturnUrl() ?? '/projects');
      }
    });
  }
}
