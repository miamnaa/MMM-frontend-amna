import { Component, OnInit, effect, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';

import { OtpService } from '../../../core/services/otp.service';
import { Logo } from '../../../shared/ui/logo/logo';

/** The email-code second factor, required after Microsoft sign-in and before the dashboard (see otp.guard.ts). */
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

  readonly requesting = this.otpService.requesting;
  readonly verifying = this.otpService.verifying;
  readonly requestError = this.otpService.requestError;
  readonly verifyError = this.otpService.verifyError;
  readonly codeSent = this.otpService.codeSent;

  readonly code = signal('');

  ngOnInit(): void {
    // Fire the first code automatically - the user shouldn't have to click
    // anything just to get the email moving.
    this.otpService.requestCode();
  }

  onCodeInput(value: string): void {
    // Digits only, capped at 6 - matches the backend's fixed-length code.
    this.code.set(value.replace(/\D/g, '').slice(0, 6));
  }

  resend(): void {
    this.otpService.requestCode();
  }

  submit(): void {
    if (this.code().length !== 6 || this.verifying()) return;
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
