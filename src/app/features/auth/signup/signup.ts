import { Component, inject, signal } from '@angular/core';
import { Router, RouterLink } from '@angular/router';

/** Sign-up is single sign-on only — accounts come from Microsoft Entra ID. */
@Component({
  selector: 'app-signup',
  imports: [RouterLink],
  templateUrl: './signup.html',
  styleUrls: ['../auth-page.css'],
})
export class Signup {
  private readonly router = inject(Router);

  readonly submitting = signal(false);

  /** Marketplace purchases activate through the SaaS Fulfillment API. */
  continueWithMicrosoft(): void {
    if (this.submitting()) return;
    this.submitting.set(true);
    setTimeout(() => {
      this.submitting.set(false);
      this.router.navigate(['/overview']);
    }, 600);
  }
}
