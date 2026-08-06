import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable, delay, of } from 'rxjs';

import { environment } from '../../../environments/environment';
import { DATASETS } from '../mock/mock-data';
import { Dataset } from '../models/domain.models';

const LATENCY = 320;

@Injectable({ providedIn: 'root' })
export class DatasetService {
  private readonly http = inject(HttpClient);
  private readonly url = `${environment.apiBaseUrl}/datasets`;
  private datasets = [...DATASETS];

  list(projectId?: string): Observable<Dataset[]> {
    if (!environment.useMockApi) {
      return this.http.get<Dataset[]>(this.url, {
        params: projectId ? { projectId } : {},
      });
    }
    const rows = projectId ? this.datasets.filter((d) => d.projectId === projectId) : this.datasets;
    return of(rows).pipe(delay(LATENCY));
  }

  get(id: string): Observable<Dataset | undefined> {
    if (!environment.useMockApi) {
      return this.http.get<Dataset>(`${this.url}/${id}`);
    }
    return of(this.datasets.find((d) => d.id === id)).pipe(delay(LATENCY));
  }

  /**
   * The real upload streams straight to Blob Storage; the API only records
   * metadata and kicks off schema validation. Here we simulate the outcome.
   */
  upload(file: File, projectId: string): Observable<Dataset> {
    if (!environment.useMockApi) {
      const form = new FormData();
      form.append('file', file);
      form.append('projectId', projectId);
      return this.http.post<Dataset>(this.url, form);
    }

    const dataset: Dataset = {
      id: `d-${this.datasets.length + 1}`,
      projectId,
      name: file.name.replace(/\.[^.]+$/, ''),
      fileName: file.name,
      sizeBytes: file.size,
      rowCount: 0,
      uploadedAt: new Date().toISOString(),
      uploadedBy: 'Amna Minhas',
      validationStatus: 'pending',
      columns: [],
      issues: [],
      dateRange: null,
    };
    this.datasets = [dataset, ...this.datasets];
    return of(dataset).pipe(delay(900));
  }

  remove(id: string): Observable<void> {
    if (!environment.useMockApi) {
      return this.http.delete<void>(`${this.url}/${id}`);
    }
    this.datasets = this.datasets.filter((d) => d.id !== id);
    return of(undefined).pipe(delay(LATENCY));
  }
}
