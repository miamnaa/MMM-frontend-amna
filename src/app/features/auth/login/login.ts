import { Component, computed, inject, signal } from '@angular/core';
import { Router, RouterLink } from '@angular/router';

import { AuthShell } from '../auth-shell/auth-shell';

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

@Component({
  selector: 'app-login',
  imports: [RouterLink, AuthShell],
  templateUrl: './login.html',
  styleUrls: ['../auth-form.css'],
})
export class Login {
  private readonly router = inject(Router);

  readonly email = signal('');
  readonly password = signal('');
  readonly remember = signal(true);
  readonly touched = signal(false);
  readonly submitting = signal(false);
  readonly error = signal<string | null>(null);

  readonly emailError = computed(() => {
    if (!this.touched()) return null;
    if (!this.email().trim()) return 'Enter your work email.';
    if (!EMAIL_PATTERN.test(this.email().trim())) return 'That does not look like a valid email.';
    return null;
  });

  readonly passwordError = computed(() => {
    if (!this.touched()) return null;
    return this.password() ? null : 'Enter your password.';
  });

  readonly valid = computed(
    () => EMAIL_PATTERN.test(this.email().trim()) && this.password().length > 0,
  );

  setEmail(value: string): void {
    this.email.set(value);
    this.error.set(null);
  }

  setPassword(value: string): void {
    this.password.set(value);
    this.error.set(null);
  }

  toggleRemember(value: boolean): void {
    this.remember.set(value);
  }

  submit(event: Event): void {
    event.preventDefault();
    this.touched.set(true);
    if (!this.valid() || this.submitting()) return;

    this.submitting.set(true);
    this.error.set(null);

    // TODO: replace with POST /auth/login once the API lands (CMP-20).
    setTimeout(() => {
      this.submitting.set(false);
      this.router.navigate(['/overview']);
    }, 600);
  }

  /** Real flow redirects to Entra ID, which returns a token to the SPA. */
  signInWithMicrosoft(): void {
    this.submitting.set(true);
    setTimeout(() => {
      this.submitting.set(false);
      this.router.navigate(['/overview']);
    }, 600);
  }
}
