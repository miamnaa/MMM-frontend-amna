import { Component, OnInit, inject, signal } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { MsalService } from '@azure/msal-angular';
import { PromptValue } from '@azure/msal-browser';

import { API_SCOPES } from '../../../core/auth/auth-config';
import { Logo } from '../../../shared/ui/logo/logo';

/** Sign-in is single sign-on only — Entra ID is the sole identity provider. */
@Component({
  selector: 'app-login',
  imports: [RouterLink, Logo],
  templateUrl: './login.html',
  styleUrl: './login.css',
})
export class Login implements OnInit {
  private readonly msalService = inject(MsalService);
  private readonly router = inject(Router);

  readonly submitting = signal(false);
  readonly error = signal<string | null>(null);

  ngOnInit(): void {
    // A signed-in visitor landing on /login directly (back button, stale
    // tab) shouldn't be asked to sign in again. Sent to /projects, not
    // /overview - otpGuard bounces them to /verify first if they haven't
    // done the email-code step yet this session.
    if (this.msalService.instance.getActiveAccount()) {
      this.router.navigate(['/projects']);
    }
  }

  signInWithMicrosoft(): void {
    if (this.submitting()) return;
    this.submitting.set(true);
    this.error.set(null);

    // loginRedirect navigates the whole browser away - popup completion
    // depends on the main window reading window.opener off the popup once
    // Microsoft redirects it, and a Cross-Origin-Opener-Policy header blocks
    // exactly that read. Redirect has no second window, so nothing to sever.
    // redirectStartPage sends the browser to /projects once sign-in
    // succeeds, rather than back to this page - otpGuard still bounces to
    // /verify first if the email-code step hasn't happened this session.
    // prompt: SELECT_ACCOUNT forces Microsoft's account-chooser screen every
    // time, even when there's already an active SSO session that would
    // otherwise sign someone in silently with no choice at all.
    this.msalService
      .loginRedirect({
        scopes: API_SCOPES,
        redirectStartPage: `${window.location.origin}/projects`,
        prompt: PromptValue.SELECT_ACCOUNT,
      })
      .subscribe({
        error: (err: unknown) => {
          this.submitting.set(false);
          console.error('Microsoft sign-in failed', err);
          this.error.set(
            'Sign-in failed to start. Please try again — if this keeps happening, contact your admin.',
          );
        },
      });
  }
}
