import { Component, inject } from '@angular/core';
import { RouterLink, RouterLinkActive } from '@angular/router';
import { MsalService } from '@azure/msal-angular';

import { Logo } from '../../shared/ui/logo/logo';
import { OtpService } from '../services/otp.service';

interface NavItem {
  label: string;
  path: string;
  icon: string;
}

@Component({
  selector: 'app-sidebar',
  imports: [RouterLink, RouterLinkActive, Logo],
  templateUrl: './sidebar.html',
  styleUrl: './sidebar.css',
})
export class Sidebar {
  private readonly msalService = inject(MsalService);
  private readonly otpService = inject(OtpService);

  readonly primary: NavItem[] = [
    { label: 'Overview', path: '/overview', icon: '◱' },
    { label: 'Projects', path: '/projects', icon: '▤' },
    { label: 'Datasets', path: '/datasets', icon: 'database' },
    { label: 'Experiments', path: '/experiments', icon: '▷' },
    { label: 'Model Studio', path: '/model-studio', icon: '⚙' },
  ];

  readonly analysis: NavItem[] = [
    { label: 'Results & Insights', path: '/results', icon: '◨' },
    { label: 'Scenario Planner', path: '/scenarios', icon: '◈' },
  ];

  readonly system: NavItem[] = [{ label: 'Settings', path: '/settings', icon: '⚒' }];

  /** Local sign-out - see header.ts's signOut() for why, in full, including why it hard-reloads instead of routing. */
  signOut(): void {
  this.otpService.clear();
  this.msalService.logoutRedirect({
    postLogoutRedirectUri: `${window.location.origin}/login`,
  });
}}