import { Component, inject } from '@angular/core';
import { Router, RouterLink, RouterLinkActive } from '@angular/router';

import { Logo } from '../../shared/ui/logo/logo';

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
  private readonly router = inject(Router);

  readonly primary: NavItem[] = [
    { label: 'Overview', path: '/overview', icon: '◱' },
    { label: 'Projects', path: '/projects', icon: '▤' },
    { label: 'Datasets', path: '/datasets', icon: '↥' },
    { label: 'Experiments', path: '/experiments', icon: '▷' },
    { label: 'Model Studio', path: '/model-studio', icon: '⚙' },
  ];

  readonly analysis: NavItem[] = [
    { label: 'Results & Insights', path: '/results', icon: '◨' },
    { label: 'Scenario Planner', path: '/scenarios', icon: '◈' },
  ];

  readonly system: NavItem[] = [{ label: 'Settings', path: '/settings', icon: '⚒' }];

  signOut(): void {
    // TODO: clear the Entra token and call the API's sign-out once auth lands.
    this.router.navigate(['/login']);
  }
}
