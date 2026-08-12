import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable, map, of, throwError } from 'rxjs';

import { environment } from '../../../environments/environment';
import { Dataset } from '../models/domain.models';
import { SavedCalibration, SavedConfiguration, SavedOptimize } from './tunnel.service';

const notAvailable = () =>
  throwError(() => new Error('Datasets are not connected to a backend yet.'));

/**
 * The shape POST /projects/:projectId/datasets is expected to return, once
 * the migration/storage that make it actually live have shipped - unverified
 * against a real response, since the endpoint 404s as of 2026-08-11.
 */
interface ApiDatasetCreateResponse {
  id: string;
  name: string;
  fileName?: string;
  uploadedAt?: string;
}

/** Mirrors the real PATCH /datasets/:id/hyperparameters body exactly. */
export interface HyperparameterChannel {
  channel: string;
  carryover: number;
  saturation: number;
}

/**
 * `list`/`get`/`upload`/`remove` still have no real backend (API-REFERENCE.md,
 * "What is not built yet") and stay honest about that. The four
 * `save*` methods below ARE real, shipped 2026-08-12 - each is a thin PATCH
 * to `/datasets/:id/...`, all requiring the dataset's own id (not the
 * project's), matching what the backend actually scopes them by.
 */
@Injectable({ providedIn: 'root' })
export class DatasetService {
  private readonly http = inject(HttpClient);

  list(_projectId?: string): Observable<Dataset[]> {
    return of([]);
  }

  get(_id: string): Observable<Dataset | undefined> {
    return of(undefined);
  }

  upload(_file: File, _projectId: string): Observable<Dataset> {
    return notAvailable();
  }

  /**
   * The real Upload Data screen's call - multipart, matching the documented
   * request shape exactly (a `file` field plus `name` and `modelType` text
   * fields). Expected to fail for now: the migration hasn't run against the
   * real environment and file storage isn't configured (see Anas re: backend
   * status, 2026-08-11). Upload Data itself is what falls back to local
   * state on failure - this method just makes the real, honest attempt.
   */
  createForProject(projectId: string, file: File, name: string, modelType: string): Observable<Dataset> {
    const form = new FormData();
    form.append('file', file);
    form.append('name', name);
    form.append('modelType', modelType);

    return this.http
      .post<ApiDatasetCreateResponse>(`${environment.apiBaseUrl}/projects/${projectId}/datasets`, form)
      .pipe(map((r) => this.toDataset(r, projectId)));
  }

  /**
   * Real endpoint. Response is documented as "the full, updated dataset
   * object (same shape GET /datasets/:id returns)" - that shape isn't
   * defined anywhere in this codebase yet (no real GET /datasets/:id call
   * exists), so the response is left loosely typed. Callers only need to
   * know the save succeeded, not consume fields back from it.
   */
  saveConfiguration(datasetId: string, body: SavedConfiguration): Observable<unknown> {
    return this.http.patch(`${environment.apiBaseUrl}/datasets/${datasetId}/configuration`, body);
  }

  /**
   * Real endpoint, CSV only for now - XLSX/Parquet return a 400 with a
   * clear message, which callers should treat as "fall back to manual
   * entry for this dataset," not as a hard failure.
   */
  getColumns(datasetId: string): Observable<string[]> {
    return this.http
      .get<{ columns: string[] }>(`${environment.apiBaseUrl}/datasets/${datasetId}/columns`)
      .pipe(map((r) => r.columns));
  }

  saveOptimize(datasetId: string, body: SavedOptimize): Observable<unknown> {
    return this.http.patch(`${environment.apiBaseUrl}/datasets/${datasetId}/optimize`, body);
  }

  saveCalibration(datasetId: string, body: SavedCalibration): Observable<unknown> {
    return this.http.patch(`${environment.apiBaseUrl}/datasets/${datasetId}/calibration`, body);
  }

  /**
   * Requires Configuration to already be saved - the backend checks that
   * `channels` contains exactly the same channel names as Configure's
   * mediaColumns, no more/fewer, any order. hyperparametersContextGuard is
   * what guarantees that's true before this screen is even reachable.
   */
  saveHyperparameters(datasetId: string, channels: HyperparameterChannel[]): Observable<unknown> {
    return this.http.patch(`${environment.apiBaseUrl}/datasets/${datasetId}/hyperparameters`, { channels });
  }

  remove(_id: string): Observable<void> {
    return notAvailable();
  }

  /** Fills in what an unverified response shape doesn't - see ApiDatasetCreateResponse. */
  private toDataset(row: ApiDatasetCreateResponse, projectId: string): Dataset {
    return {
      id: row.id,
      projectId,
      name: row.name,
      fileName: row.fileName ?? row.name,
      sizeBytes: 0,
      rowCount: 0,
      uploadedAt: row.uploadedAt ?? new Date().toISOString(),
      uploadedBy: '',
      validationStatus: 'pending',
      columns: [],
      issues: [],
      dateRange: null,
    };
  }
}
