import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable, delay, of } from 'rxjs';

import { environment } from '../../../environments/environment';
import { PROJECTS } from '../mock/mock-data';
import { ModelingEngine, Project } from '../models/domain.models';

const LATENCY = 320;

@Injectable({ providedIn: 'root' })
export class ProjectService {
  private readonly http = inject(HttpClient);
  private readonly url = `${environment.apiBaseUrl}/projects`;
  private projects = [...PROJECTS];

  list(): Observable<Project[]> {
    if (!environment.useMockApi) {
      return this.http.get<Project[]>(this.url);
    }
    return of(this.projects).pipe(delay(LATENCY));
  }

  get(id: string): Observable<Project | undefined> {
    if (!environment.useMockApi) {
      return this.http.get<Project>(`${this.url}/${id}`);
    }
    return of(this.projects.find((p) => p.id === id)).pipe(delay(LATENCY));
  }

  create(input: { name: string; description: string; engine: ModelingEngine }): Observable<Project> {
    if (!environment.useMockApi) {
      return this.http.post<Project>(this.url, input);
    }
    const now = new Date().toISOString();
    const project: Project = {
      id: `p-${this.projects.length + 1}`,
      name: input.name,
      description: input.description,
      engine: input.engine,
      createdAt: now,
      updatedAt: now,
      ownerName: 'Amna Minhas',
      experimentCount: 0,
      datasetCount: 0,
    };
    this.projects = [project, ...this.projects];
    return of(project).pipe(delay(LATENCY));
  }
}
