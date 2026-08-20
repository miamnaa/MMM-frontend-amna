import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';

import {
  ApiInvite,
  ApiMember,
  GLOBAL_ROLE_LABELS,
  GLOBAL_ROLE_OPTIONS,
  GlobalRole,
  MembersService,
  NotificationPreferences,
} from '../../core/services/members.service';
import { SessionService } from '../../core/services/notification.service';
import { PageHeader } from '../../shared/ui/page-header/page-header';
import { backendErrorMessage } from '../../shared/utils/backend-error';

@Component({
  selector: 'app-settings',
  imports: [FormsModule, PageHeader],
  templateUrl: './settings.html',
  styleUrl: './settings.css',
})
export class Settings implements OnInit {
  private readonly session = inject(SessionService);
  private readonly membersService = inject(MembersService);

  readonly user = this.session.user;
  readonly roleLabels = GLOBAL_ROLE_LABELS;
  readonly roleOptions = GLOBAL_ROLE_OPTIONS;

  readonly members = signal<ApiMember[]>([]);
  readonly invites = signal<ApiInvite[]>([]);
  readonly loadingMembers = signal(true);
  readonly membersError = signal<string | null>(null);

  /** Real role-change/remove controls and the invite form only show once this is confirmed true from the real member list - never assumed. */
  readonly isAdmin = computed(() =>
    this.members().some((m) => m.id === this.session.userId() && m.globalRole === 'administrator'),
  );

  readonly inviteEmail = signal('');
  readonly inviteRole = signal<GlobalRole>('marketing_analyst');
  readonly inviting = signal(false);
  readonly inviteError = signal<string | null>(null);

  readonly roleChangeError = signal<string | null>(null);
  readonly savingRoleFor = signal<string | null>(null);

  readonly removeTarget = signal<ApiMember | null>(null);
  readonly removing = signal(false);
  readonly removeError = signal<string | null>(null);

  readonly preferences = signal<NotificationPreferences | null>(null);
  readonly savingPreference = signal<keyof NotificationPreferences | null>(null);

  ngOnInit(): void {
    this.loadMembers();
    this.loadInvites();
    this.membersService.getNotificationPreferences().subscribe({
      next: (prefs) => this.preferences.set(prefs),
      error: (err: unknown) => console.error('Failed to load notification preferences', err),
    });
  }

  private loadMembers(): void {
    this.loadingMembers.set(true);
    this.membersService.listMembers().subscribe({
      next: (members) => {
        this.members.set(members);
        this.loadingMembers.set(false);
      },
      error: (err: unknown) => {
        this.membersError.set(backendErrorMessage(err, 'Could not load members.'));
        this.loadingMembers.set(false);
      },
    });
  }

  private loadInvites(): void {
    this.membersService.listInvites().subscribe({
      next: (invites) => this.invites.set(invites),
      error: (err: unknown) => console.error('Failed to load pending invites', err),
    });
  }

  sendInvite(): void {
    const email = this.inviteEmail().trim();
    if (!email || this.inviting()) return;

    this.inviting.set(true);
    this.inviteError.set(null);

    this.membersService.invite(email, this.inviteRole()).subscribe({
      next: () => {
        this.inviting.set(false);
        this.inviteEmail.set('');
        this.inviteRole.set('marketing_analyst');
        this.loadInvites();
      },
      error: (err: unknown) => {
        this.inviting.set(false);
        this.inviteError.set(backendErrorMessage(err, 'Could not send this invite. Try again.'));
      },
    });
  }

  changeRole(member: ApiMember, role: GlobalRole): void {
    if (role === member.globalRole) return;
    this.savingRoleFor.set(member.id);
    this.roleChangeError.set(null);

    this.membersService.changeRole(member.id, role).subscribe({
      next: (updated) => {
        this.savingRoleFor.set(null);
        this.members.update((list) => list.map((m) => (m.id === updated.id ? updated : m)));
      },
      error: (err: unknown) => {
        this.savingRoleFor.set(null);
        this.roleChangeError.set(backendErrorMessage(err, "Could not change this member's role."));
      },
    });
  }

  confirmRemove(member: ApiMember): void {
    this.removeError.set(null);
    this.removeTarget.set(member);
  }

  cancelRemove(): void {
    this.removeTarget.set(null);
  }

  removeMember(): void {
    const target = this.removeTarget();
    if (!target || this.removing()) return;
    this.removing.set(true);
    this.removeError.set(null);

    this.membersService.remove(target.id).subscribe({
      next: () => {
        this.removing.set(false);
        this.removeTarget.set(null);
        this.members.update((list) => list.filter((m) => m.id !== target.id));
      },
      error: (err: unknown) => {
        this.removing.set(false);
        this.removeError.set(backendErrorMessage(err, 'Could not remove this member.'));
      },
    });
  }

  togglePreference(key: keyof NotificationPreferences): void {
    const current = this.preferences();
    if (!current || this.savingPreference()) return;

    const next = !current[key];
    this.savingPreference.set(key);
    // Optimistic - reverted below if the real save fails.
    this.preferences.set({ ...current, [key]: next });

    this.membersService.updateNotificationPreferences({ [key]: next }).subscribe({
      next: (saved) => {
        this.savingPreference.set(null);
        this.preferences.set(saved);
      },
      error: (err: unknown) => {
        this.savingPreference.set(null);
        this.preferences.set(current);
        console.error('Failed to save notification preference', backendErrorMessage(err, 'Could not save this preference.'));
      },
    });
  }
}
