import { Component, computed, inject, signal } from '@angular/core';
import { Router, RouterLink } from '@angular/router';

import { AuthShell } from '../auth-shell/auth-shell';

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

@Component({
  selector: 'app-signup',
  imports: [RouterLink, AuthShell],
  templateUrl: './signup.html',
  styleUrls: ['../auth-form.css', './signup.css'],
})
export class Signup {
  private readonly router = inject(Router);

  readonly fullName = signal('');
  readonly company = signal('');
  readonly email = signal('');
  readonly password = signal('');
  readonly acceptedTerms = signal(false);
  readonly touched = signal(false);
  readonly submitting = signal(false);

  readonly nameError = computed(() =>
    this.touched() && !this.fullName().trim() ? 'Enter your name.' : null,
  );

  readonly companyError = computed(() =>
    this.touched() && !this.company().trim() ? 'Enter your company name.' : null,
  );

  readonly emailError = computed(() => {
    if (!this.touched()) return null;
    if (!this.email().trim()) return 'Enter your work email.';
    if (!EMAIL_PATTERN.test(this.email().trim())) return 'That does not look like a valid email.';
    return null;
  });

  readonly passwordError = computed(() => {
    if (!this.touched()) return null;
    if (this.password().length < 12) return 'Use at least 12 characters.';
    return null;
  });

  readonly termsError = computed(() =>
    this.touched() && !this.acceptedTerms() ? 'You need to accept the terms to continue.' : null,
  );

  /** Simple strength read-out: length plus character variety. */
  readonly strength = computed(() => {
    const value = this.password();
    if (!value) return { score: 0, label: 'Empty', className: 'none' };

    let score = 0;
    if (value.length >= 12) score++;
    if (value.length >= 16) score++;
    if (/[A-Z]/.test(value) && /[a-z]/.test(value)) score++;
    if (/\d/.test(value)) score++;
    if (/[^A-Za-z0-9]/.test(value)) score++;

    if (score <= 2) return { score, label: 'Weak', className: 'weak' };
    if (score <= 3) return { score, label: 'Fair', className: 'fair' };
    if (score <= 4) return { score, label: 'Good', className: 'good' };
    return { score, label: 'Strong', className: 'strong' };
  });

  readonly valid = computed(
    () =>
      !!this.fullName().trim() &&
      !!this.company().trim() &&
      EMAIL_PATTERN.test(this.email().trim()) &&
      this.password().length >= 12 &&
      this.acceptedTerms(),
  );

  set(field: 'fullName' | 'company' | 'email' | 'password', value: string): void {
    this[field].set(value);
  }

  toggleTerms(value: boolean): void {
    this.acceptedTerms.set(value);
  }

  submit(event: Event): void {
    event.preventDefault();
    this.touched.set(true);
    if (!this.valid() || this.submitting()) return;

    this.submitting.set(true);

    // TODO: replace with POST /auth/signup once the API lands (CMP-20).
    setTimeout(() => {
      this.submitting.set(false);
      this.router.navigate(['/overview']);
    }, 700);
  }

  /** Marketplace purchases activate through the SaaS Fulfillment API. */
  continueWithMicrosoft(): void {
    this.submitting.set(true);
    setTimeout(() => {
      this.submitting.set(false);
      this.router.navigate(['/overview']);
    }, 600);
  }
}
