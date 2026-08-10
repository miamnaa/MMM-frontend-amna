import { Component, inject, signal } from '@angular/core';

import { SessionService } from '../../core/services/notification.service';
import { PageHeader } from '../../shared/ui/page-header/page-header';

interface Member {
  name: string;
  email: string;
  role: string;
  status: 'active' | 'invited';
}

@Component({
  selector: 'app-settings',
  imports: [PageHeader],
  templateUrl: './settings.html',
  styleUrl: './settings.css',
})
export class Settings {
  private readonly session = inject(SessionService);

  readonly user = this.session.user;

  /** No /members or /users route exists on the real API yet - nothing to fetch or fabricate. */
  readonly members = signal<Member[]>([]);

  readonly preferences = signal({
    emailOnRunComplete: true,
    emailOnRunFailed: true,
    weeklyDigest: false,
  });

  togglePreference(key: keyof ReturnType<typeof this.preferences>): void {
    this.preferences.update((p) => ({ ...p, [key]: !p[key] }));
  }
}
