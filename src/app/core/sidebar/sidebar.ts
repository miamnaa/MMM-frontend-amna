import { Component, inject } from '@angular/core';
import { RouterLink, RouterLinkActive } from '@angular/router';
import { MsalService } from '@azure/msal-angular';

import { Logo } from '../../shared/ui/logo/logo';
import { localSignOut } from '../auth/local-sign-out';

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

  readonly primary: NavItem[] = [
    { label: 'Projects', path: '/projects', icon: '▤' },
    { label: 'Experiments', path: '/experiments', icon: '▷' },
    { label: 'Model Studio', path: '/model-studio', icon: '⚙' },
  ];

  readonly analysis: NavItem[] = [
    { label: 'Results & Insights', path: '/results', icon: '◨' },
    { label: 'Scenario Planner', path: '/scenarios', icon: '◈' },
  ];

  readonly system: NavItem[] = [{ label: 'Settings', path: '/settings', icon: '⚒' }];

  /** See local-sign-out.ts for why this isn't logoutRedirect()/logoutPopup(). */
  signOut(): void {
    void localSignOut(this.msalService);
  }
}