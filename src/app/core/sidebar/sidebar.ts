import { Component } from '@angular/core';
import { RouterLink, RouterLinkActive } from '@angular/router';

interface NavItem {
  label: string;
  path: string;
  icon: string;
}

@Component({
  selector: 'app-sidebar',
  imports: [RouterLink, RouterLinkActive],
  templateUrl: './sidebar.html',
  styleUrl: './sidebar.css',
})
export class Sidebar {
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
}
