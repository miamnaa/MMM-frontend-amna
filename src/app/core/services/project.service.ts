import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable, map } from 'rxjs';

import { environment } from '../../../environments/environment';
import { Project } from '../models/domain.models';
import { SessionService } from './notification.service';

/** The exact wire shape of GET/POST /projects (API-REFERENCE.md, "Data model: Project"). */
interface ApiProject {
  id: string;
  createdAt: string;
  updatedAt: string;
  tenantId: string;
  ownerId: string;
  name: string;
  description: string | null;
  status: 'active' | 'archived';
  deletedAt: string | null;
  /** Real field on both list() and get(), shipped 2026-08-13 - datasetCount was 0 hardcoded before this. */
  datasetCount?: number;
}

/** Real backend behind every method here - the only domain with one right now. */
@Injectable({ providedIn: 'root' })
export class ProjectService {
  private readonly http = inject(HttpClient);
  private readonly session = inject(SessionService);
  private readonly url = `${environment.apiBaseUrl}/projects`;

  list(): Observable<Project[]> {
    return this.http.get<ApiProject[]>(this.url).pipe(map((rows) => rows.map((r) => this.toProject(r))));
  }

  get(id: string): Observable<Project | undefined> {
    return this.http.get<ApiProject>(`${this.url}/${id}`).pipe(map((r) => this.toProject(r)));
  }

  /**
   * The backend only accepts name + description on create (any other field
   * is silently ignored) and always starts a new project at status "active"
   * - there's no engine concept on this endpoint at all.
   */
  create(input: { name: string; description: string }): Observable<Project> {
    return this.http
      .post<ApiProject>(this.url, { name: input.name, description: input.description || undefined })
      .pipe(map((r) => this.toProject(r)));
  }

  /**
   * Partial update - only send fields that are actually changing. The
   * backend leaves omitted fields untouched (a real bug where they used to
   * get wiped to null was fixed 2026-08-06 and is now covered by a
   * regression test on their side, per API-REFERENCE.md). Same ownership
   * rule as remove(): a non-owner gets a 403.
   */
  update(id: string, changes: Partial<{ name: string; description: string; status: 'active' | 'archived' }>): Observable<Project> {
    return this.http.patch<ApiProject>(`${this.url}/${id}`, changes).pipe(map((r) => this.toProject(r)));
  }

  /**
   * Soft delete - the row stays in the database with deletedAt set, but
   * disappears from list()/get() immediately after. Only the project's
   * owner may do this; a non-owner gets a 403 the caller surfaces as a
   * generic error, same as any other failed request.
   */
  remove(id: string): Observable<void> {
    return this.http.delete<void>(`${this.url}/${id}`);
  }

  /**
   * Fills in what the API doesn't return: ownerName (only ownerId comes
   * back, and there's no /users endpoint to resolve someone else's), and
   * experimentCount (Experiments has no backend yet, so 0 is the honest
   * count, not a guess). datasetCount IS real now (shipped 2026-08-13) -
   * `?? 0` is just a defensive fallback, not an assumption it's missing.
   */
  private toProject(row: ApiProject): Project {
    const isMine = row.ownerId === this.session.userId();
    return {
      id: row.id,
      name: row.name,
      description: row.description ?? '',
      status: row.status,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
      ownerName: isMine ? this.session.user().name : 'Team member',
      isMine,
      experimentCount: 0,
      datasetCount: row.datasetCount ?? 0,
    };
  }
}
