import { Component, inject, signal } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { MsalService } from '@azure/msal-angular';

import { API_SCOPES } from '../../../core/auth/auth-config';
import { Logo } from '../../../shared/ui/logo/logo';

/** Sign-in is single sign-on only — Entra ID is the sole identity provider. */
@Component({
  selector: 'app-login',
  imports: [RouterLink, Logo],
  templateUrl: './login.html',
  styleUrl: './login.css',
})
export class Login {
  private readonly msalService = inject(MsalService);
  private readonly router = inject(Router);

  readonly submitting = signal(false);
  readonly error = signal<string | null>(null);

  signInWithMicrosoft(): void {
    if (this.submitting()) return;
    this.submitting.set(true);
    this.error.set(null);

    this.msalService.loginPopup({ scopes: API_SCOPES }).subscribe({
      next: () => {
        this.submitting.set(false);
        this.router.navigate(['/overview']);
      },
      error: (err: unknown) => {
        this.submitting.set(false);
        console.error('Microsoft sign-in failed', err);
        this.error.set(
          'Sign-in was cancelled or failed. Please try again — if this keeps happening, contact your admin.',
        );
      },
    });
  }
}
