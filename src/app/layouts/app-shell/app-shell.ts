import { Component, OnDestroy, OnInit, inject, signal } from '@angular/core';
import { ActivatedRoute, NavigationEnd, Router, RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { MsalService } from '@azure/msal-angular';
import { Subscription, filter } from 'rxjs';

import { localSignOut } from '../../core/auth/local-sign-out';
import { Logo } from '../../shared/ui/logo/logo';

/**
 * The one real persistent nav element, present identically on every screen
 * from the Project list down through Hyperparameterization - built once
 * here rather than re-added per screen. "Models" only shows once inside a
 * project, derived from the *active route's* :projectId, not from
 * TunnelService's in-memory session state - that stays correct even after
 * a hard refresh or a resumed session where TunnelService hasn't been
 * repopulated yet.
 */
@Component({
  selector: 'app-shell',
  imports: [RouterOutlet, RouterLink, RouterLinkActive, Logo],
  templateUrl: './app-shell.html',
  styleUrl: './app-shell.css',
})
export class AppShell implements OnInit, OnDestroy {
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly msalService = inject(MsalService);
  private readonly sub = new Subscription();

  readonly currentProjectId = signal<string | null>(null);

  ngOnInit(): void {
    this.updateProjectId();
    this.sub.add(
      this.router.events.pipe(filter((e) => e instanceof NavigationEnd)).subscribe(() => this.updateProjectId()),
    );
  }

  ngOnDestroy(): void {
    this.sub.unsubscribe();
  }

  private updateProjectId(): void {
    this.currentProjectId.set(this.route.snapshot.firstChild?.paramMap.get('projectId') ?? null);
  }

  /** See local-sign-out.ts - the one sign-out call used throughout this app. */
  signOut(): void {
    void localSignOut(this.msalService);
  }
}
