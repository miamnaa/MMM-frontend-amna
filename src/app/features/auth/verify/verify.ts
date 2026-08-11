import { Component, OnInit, effect, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';

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

  constructor() {
    // Move on the moment the service confirms verification - into the
    // tunnel's project list, not /overview (that page still exists but
    // nothing links to it anymore).
    effect(() => {
      if (this.otpService.verified()) {
        this.router.navigate(['/projects']);
      }
    });
  }
}
