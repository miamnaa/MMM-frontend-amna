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
 * Deliberately conservative name-pattern matching on the backend, not ML -
 * dateColumn/targetColumn come back null rather than guessing wrong, so
 * every field here has to be treated as optional.
 */
export interface ColumnSuggestions {
  dateColumn: string | null;
  targetColumn: string | null;
  mediaColumns: string[];
  controlColumns: string[];
  organicColumns: string[];
}

export interface ColumnsResponse {
  columns: string[];
  suggestions: ColumnSuggestions;
}

/** The columnMapping shape GET /datasets/:id actually returns - same fields as SavedConfiguration, minus kpiType/revenuePerKpiValue, which come back as siblings instead. */
export interface SavedColumnMapping {
  dateColumn: string;
  targetColumn: string;
  mediaColumns: string[];
  controlColumns: string[];
  organicColumns: string[];
  geoColumns: string[];
}

/**
 * Real endpoint, confirmed working 2026-08-13 by Anas - the single source of
 * truth for "what did this dataset actually save at each stage," used to
 * hydrate every step screen on mount instead of leaving them blank or
 * re-guessing. Every field is null until its own step was actually saved.
 */
export interface ApiDatasetDetail {
  id: string;
  name: string;
  columnMapping: SavedColumnMapping | null;
  kpiType: 'revenue' | 'non_revenue' | null;
  revenuePerKpiValue?: number;
  dateRange: SavedOptimize | null;
  calibration: SavedCalibration | null;
  channelHyperparameters: HyperparameterChannel[] | null;
}

/**
 * The real shape of a row from GET /projects/:projectId/datasets isn't
 * documented beyond "carries everything needed to compute status" - only
 * presence (null vs. not) of these four is relied on for that. columnMapping's
 * *contents* are additionally assumed (not verified) to mirror exactly what
 * saveConfiguration() PATCHes, since that's the natural shape for the
 * backend to store and echo back - this is the one place that assumption
 * matters, when reconstructing session state to resume a partially
 * configured dataset (see project-models.ts).
 */
export interface ApiProjectDataset {
  id: string;
  name: string;
  modelType?: string;
  columnMapping: SavedConfiguration | null;
  dateRange: SavedOptimize | null;
  calibration: SavedCalibration | null;
  channelHyperparameters: HyperparameterChannel[] | null;
}

/**
 * `list`/`upload` still have no real backend (API-REFERENCE.md, "What is
 * not built yet") and stay honest about that. The four `save*` methods and
 * `getDataset()` below ARE real - each a thin PATCH/GET against
 * `/datasets/:id/...`, all requiring the dataset's own id (not the
 * project's), matching what the backend actually scopes them by.
 */
@Injectable({ providedIn: 'root' })
export class DatasetService {
  private readonly http = inject(HttpClient);

  list(_projectId?: string): Observable<Dataset[]> {
    return of([]);
  }

  /**
   * Real endpoint, confirmed working 2026-08-13 - the one place every step
   * screen (Configure/Optimize/Calibrate/Hyperparameters) reads back what
   * was actually saved on mount, instead of leaving its form blank or
   * re-guessing from the raw file every time the screen is left and
   * reopened.
   */
  getDataset(id: string): Observable<ApiDatasetDetail> {
    return this.http.get<ApiDatasetDetail>(`${environment.apiBaseUrl}/datasets/${id}`);
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
  getColumns(datasetId: string): Observable<ColumnsResponse> {
    return this.http.get<ColumnsResponse>(`${environment.apiBaseUrl}/datasets/${datasetId}/columns`);
  }

  /** Real endpoint - what the project-models hub lists, with real per-dataset progress. */
  listForProject(projectId: string): Observable<ApiProjectDataset[]> {
    return this.http.get<ApiProjectDataset[]>(`${environment.apiBaseUrl}/projects/${projectId}/datasets`);
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

  /** Real endpoint - soft delete, backend keeps the row for audit and excludes it from listForProject() after. */
  remove(id: string): Observable<void> {
    return this.http.delete<void>(`${environment.apiBaseUrl}/datasets/${id}`);
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
