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

  readonly members = signal<Member[]>([
    { name: 'Amna Minhas', email: 'amna@convergentbt.com', role: 'Admin', status: 'active' },
    { name: 'Muhammad Anas', email: 'anas@convergentbt.com', role: 'Analyst', status: 'active' },
    { name: 'Hammad Ahmed', email: 'hammad@convergentbt.com', role: 'Analyst', status: 'active' },
    { name: 'Farhan Ahmed', email: 'farhan@convergentbt.com', role: 'Admin', status: 'invited' },
  ]);

  readonly preferences = signal({
    emailOnRunComplete: true,
    emailOnRunFailed: true,
    weeklyDigest: false,
  });

  togglePreference(key: keyof ReturnType<typeof this.preferences>): void {
    this.preferences.update((p) => ({ ...p, [key]: !p[key] }));
  }
}
