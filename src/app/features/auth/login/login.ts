import { Component, inject, signal } from '@angular/core';
import { Router } from '@angular/router';

/** Sign-in is single sign-on only — Entra ID is the sole identity provider. */
@Component({
  selector: 'app-login',
  imports: [],
  templateUrl: './login.html',
  styleUrl: './login.css',
})
export class Login {
  private readonly router = inject(Router);

  readonly submitting = signal(false);

  /** Real flow redirects to Entra ID, which returns a token to the SPA. */
  signInWithMicrosoft(): void {
    if (this.submitting()) return;
    this.submitting.set(true);
    setTimeout(() => {
      this.submitting.set(false);
      this.router.navigate(['/overview']);
    }, 600);
  }
}
