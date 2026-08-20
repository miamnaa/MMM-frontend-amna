import { Component, inject, signal } from '@angular/core';
import { ActivatedRoute, NavigationEnd, Router, RouterOutlet } from '@angular/router';
import { filter } from 'rxjs/operators';

import { Header } from '../../core/header/header';
import { Sidebar } from '../../core/sidebar/sidebar';

@Component({
  selector: 'app-main-layout',
  imports: [RouterOutlet, Header, Sidebar],
  templateUrl: './main-layout.html',
  styleUrl: './main-layout.css',
})
export class MainLayout {
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);

  /** Per-route opt-out via route `data: { hideSearch: true }` (see app.routes.ts's 'settings' entry) - Settings has no projects/datasets/experiments to search, so the shared top search bar doesn't belong there. */
  readonly hideSearch = signal(this.currentHideSearch());

  constructor() {
    this.router.events.pipe(filter((e) => e instanceof NavigationEnd)).subscribe(() => {
      this.hideSearch.set(this.currentHideSearch());
    });
  }

  private currentHideSearch(): boolean {
    let route = this.route.firstChild;
    while (route?.firstChild) route = route.firstChild;
    return route?.snapshot.data['hideSearch'] === true;
  }
}
