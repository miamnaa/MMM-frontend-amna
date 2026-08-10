import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable, delay, map, of } from 'rxjs';

import { environment } from '../../../environments/environment';
import { PROJECTS } from '../mock/mock-data';
import { Project } from '../models/domain.models';
import { SessionService } from './notification.service';

const LATENCY = 320;

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
}

@Injectable({ providedIn: 'root' })
export class ProjectService {
  private readonly http = inject(HttpClient);
  private readonly session = inject(SessionService);
  private readonly url = `${environment.apiBaseUrl}/projects`;
  private projects = [...PROJECTS];

  list(): Observable<Project[]> {
    if (!environment.mock.projects) {
      return this.http.get<ApiProject[]>(this.url).pipe(map((rows) => rows.map((r) => this.toProject(r))));
    }
    return of(this.projects).pipe(delay(LATENCY));
  }

  get(id: string): Observable<Project | undefined> {
    if (!environment.mock.projects) {
      return this.http.get<ApiProject>(`${this.url}/${id}`).pipe(map((r) => this.toProject(r)));
    }
    return of(this.projects.find((p) => p.id === id)).pipe(delay(LATENCY));
  }

  /**
   * The backend only accepts name + description on create (any other field
   * is silently ignored) and always starts a new project at status "active"
   * - there's no engine concept on this endpoint at all.
   */
  create(input: { name: string; description: string }): Observable<Project> {
    if (!environment.mock.projects) {
      return this.http
        .post<ApiProject>(this.url, { name: input.name, description: input.description || undefined })
        .pipe(map((r) => this.toProject(r)));
    }
    const now = new Date().toISOString();
    const project: Project = {
      id: `p-${this.projects.length + 1}`,
      name: input.name,
      description: input.description,
      status: 'active',
      createdAt: now,
      updatedAt: now,
      ownerName: this.session.user().name,
      experimentCount: 0,
      datasetCount: 0,
    };
    this.projects = [project, ...this.projects];
    return of(project).pipe(delay(LATENCY));
  }

  /**
   * Soft delete - the row stays in the database with deletedAt set, but
   * disappears from list()/get() immediately after. Only the project's
   * owner may do this; a non-owner gets a 403 the caller surfaces as a
   * generic error, same as any other failed request.
   */
  remove(id: string): Observable<void> {
    if (!environment.mock.projects) {
      return this.http.delete<void>(`${this.url}/${id}`);
    }
    this.projects = this.projects.filter((p) => p.id !== id);
    return of(undefined).pipe(delay(LATENCY));
  }

  /**
   * Fills in what the API doesn't return: ownerName (only ownerId comes
   * back, and there's no /users endpoint to resolve someone else's), and
   * the dataset/experiment counts (those backends don't exist yet, so the
   * honest count is 0, not a guess).
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
      experimentCount: 0,
      datasetCount: 0,
    };
  }
}
