import { Component } from '@angular/core';
import { RouterLink } from '@angular/router';

import { Logo } from '../../../shared/ui/logo/logo';

/** Split-panel frame shared by the sign-in and sign-up pages. */
@Component({
  selector: 'app-auth-shell',
  imports: [RouterLink, Logo],
  templateUrl: './auth-shell.html',
  styleUrl: './auth-shell.css',
})
export class AuthShell {
  readonly highlights = [
    'Schema-validated uploads, so a bad file never costs you a run',
    'Meridian and PyMC-Marketing, with the transforms you choose',
    'Contribution, ROI and saturation with the fit diagnostics attached',
  ];
}
