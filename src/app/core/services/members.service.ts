import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';

import { environment } from '../../../environments/environment';

export type GlobalRole = 'marketing_analyst' | 'marketing_manager' | 'data_scientist' | 'administrator';

export const GLOBAL_ROLE_LABELS: Record<GlobalRole, string> = {
  marketing_analyst: 'Marketing Analyst',
  marketing_manager: 'Marketing Manager',
  data_scientist: 'Data Scientist',
  administrator: 'Administrator',
};

export const GLOBAL_ROLE_OPTIONS: { value: GlobalRole; label: string }[] = (
  Object.entries(GLOBAL_ROLE_LABELS) as [GlobalRole, string][]
).map(([value, label]) => ({ value, label }));

/** Real endpoint: GET /members - every real tenant member. */
export interface ApiMember {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  globalRole: GlobalRole;
  createdAt: string;
}

/** Real endpoint: GET /members/invites - real pending invites, not yet accepted. Kept separate from ApiMember on purpose - an invite isn't a member yet. */
export interface ApiInvite {
  id: string;
  email: string;
  role: GlobalRole;
  invitedAt: string;
  acceptedAt: string | null;
}

/** Real endpoint: GET/PATCH /me/notification-preferences. */
export interface NotificationPreferences {
  runCompleted: boolean;
  runFailed: boolean;
  weeklyDigest: boolean;
}

/**
 * Real backend behind every method here - tenant membership, invites, and
 * the signed-in user's own notification preferences. Members/invite/role/
 * remove are admin-only server-side (real 403 for anyone else) - this
 * service doesn't enforce that client-side, it just surfaces whatever the
 * backend actually says.
 */
@Injectable({ providedIn: 'root' })
export class MembersService {
  private readonly http = inject(HttpClient);

  listMembers(): Observable<ApiMember[]> {
    return this.http.get<ApiMember[]>(`${environment.apiBaseUrl}/members`);
  }

  listInvites(): Observable<ApiInvite[]> {
    return this.http.get<ApiInvite[]>(`${environment.apiBaseUrl}/members/invites`);
  }

  /** Sends a real email through Microsoft Graph - the invited role applies automatically the moment that person signs in, nothing else needed on their end. */
  invite(email: string, role: GlobalRole): Observable<unknown> {
    return this.http.post(`${environment.apiBaseUrl}/members/invite`, { email, role });
  }

  changeRole(id: string, role: GlobalRole): Observable<ApiMember> {
    return this.http.patch<ApiMember>(`${environment.apiBaseUrl}/members/${id}/role`, { role });
  }

  /** Real 400 if the caller tries to remove themselves. */
  remove(id: string): Observable<void> {
    return this.http.delete<void>(`${environment.apiBaseUrl}/members/${id}`);
  }

  getNotificationPreferences(): Observable<NotificationPreferences> {
    return this.http.get<NotificationPreferences>(`${environment.apiBaseUrl}/me/notification-preferences`);
  }

  /** Send only the toggle that changed - the backend returns the full updated real object either way. */
  updateNotificationPreferences(changes: Partial<NotificationPreferences>): Observable<NotificationPreferences> {
    return this.http.patch<NotificationPreferences>(`${environment.apiBaseUrl}/me/notification-preferences`, changes);
  }
}
