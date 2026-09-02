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

/** Real endpoint: GET /datasets/:id/rows - one real object per uploaded row, numbers as numbers. */
export interface RowsResponse {
  rows: Record<string, unknown>[];
}

/** Real endpoint: POST /datasets/:id/combine-columns - a real summed series per date. */
export interface CombineColumnsResponse {
  dateColumn: string;
  series: { date: string; value: number }[];
}

/**
 * Real endpoint: PATCH /datasets/:id/combine-channels, added 2026-08-18.
 * Unlike combine-columns above (chart-preview only, never touches saved
 * config), this one actually updates columnMapping.mediaColumns for real -
 * removes sourceColumns, adds newColumnName - so Assembly sums them into
 * every real row before training, not just the chart. Always clears
 * channelHyperparameters (comes back null): the old per-channel values no
 * longer match the new channel list, so Hyperparameterization needs a redo.
 */
export interface CombineChannelsResponse {
  columnMapping: SavedColumnMapping;
  channelHyperparameters: null;
}

/** One combined group in AutoCombineChannelsResponse - both fields explicit as of 2026-08-18, nothing to infer. */
export interface AutoCombinedGroup {
  sourceColumns: string[];
  newColumnName: string;
}

/**
 * Real endpoint: POST /datasets/:id/auto-combine-channels, added 2026-08-18.
 * Closes the gap where a real training failure (multicollinearity) only got
 * fixed because someone manually noticed the correlation table and combined
 * the pair by hand. Finds every real group of media columns correlated 90%+
 * (chained - A+B 90%+ and B+C 90%+ groups all three, not just isolated
 * pairs) and combines each group for real, same effect as calling
 * combine-channels once per group. `combined` is `[]` when nothing was
 * correlated enough - a real, valid outcome, not an error.
 */
export interface AutoCombineChannelsResponse {
  dataset: CombineChannelsResponse;
  combined: AutoCombinedGroup[];
}

/** Real endpoint: GET /datasets/:id/date-range - the real min/max date found in the uploaded file. */
export interface DateRangeResponse {
  minDate: string;
  maxDate: string;
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
  /** Real field, added 2026-08-21 alongside the invite-only projects change - the real user id of whoever uploaded this dataset. Existing datasets were backfilled with the project owner's id as the closest real fact available for data that predates this field. */
  createdByUserId?: string;
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
  /** Real field, added 2026-08-21 - the real user id of whoever uploaded this dataset. Existing datasets were backfilled with the project owner's id. */
  createdByUserId?: string;
}

/**
 * Real endpoint, confirmed working 2026-08-13 - kicks off training. The
 * response shape isn't documented beyond "it's real and tested," so this is
 * left loosely typed; callers only need to know the request was accepted,
 * then poll getTrainingStatus() for what happens next.
 */
export interface TrainModelResponse {
  status?: string;
}

/**
 * Real endpoint, confirmed working 2026-08-13. Status value names aren't
 * documented - 'pending'/'running'/'completed'/'failed' is a reasonable
 * guess at the real enum, not a verified one. isTerminalTrainingStatus()
 * below is the one place that assumption is used, so it's easy to correct
 * once a real response is seen. `errorMessage` is the confirmed real field
 * on a `failed` status (seen 2026-08-18, a real Meridian multicollinearity
 * rejection) - `message` is kept too since it's what's used for in-progress
 * status text, a different real field for a different purpose.
 *
 * As of today (Anas), `errorMessage` can ALSO appear on a real `status:
 * "running"` response during a brief, real network hiccup reaching the
 * model engine - that is NOT a failure, just an informational note; only
 * `status: "failed"` (checked by isFailedTrainingStatus below) is a real
 * failure. Callers must keep polling normally on a non-terminal status
 * regardless of whether errorMessage is present.
 *
 * Real change from Anas (today): `stepNumber`/`totalSteps`/`stepLabel`
 * describe which of the 7 fixed real pipeline steps is running right now
 * (e.g. `{ stepNumber: 3, totalSteps: 7, stepLabel: "Building the model
 * configuration" }`) - `progress` alone only ever jumps between 7 exact
 * fractions, so the raw percentage read as a confusing ".3%". These three
 * are optional: absent when `status` is `"not_started"` (nothing to show
 * yet) or during the same transient network hiccup described above for
 * `errorMessage` - keep polling normally rather than treating the absence
 * as an error.
 */
export interface TrainingStatusResponse {
  status: string;
  progress?: number;
  message?: string;
  errorMessage?: string;
  stepNumber?: number;
  totalSteps?: number;
  stepLabel?: string;
}

const TERMINAL_TRAINING_STATUSES = ['completed', 'success', 'succeeded', 'failed', 'error'];
/** Confirmed real value 2026-08-20 (GET /datasets/:id/status on a Ready, never-trained dataset returns exactly `{ status: "not_started", progress: 0, jobId: null }`). Not terminal, but must never be treated as "running" either - see isNotStartedTrainingStatus. */
const NOT_STARTED_TRAINING_STATUSES = ['not_started'];

/** True once training has reached any end state (success or failure) - see TrainingStatusResponse's caveat on the exact status names. */
export function isTerminalTrainingStatus(status: string): boolean {
  return TERMINAL_TRAINING_STATUSES.includes(status.toLowerCase());
}

/**
 * True when training has never been started for this dataset at all - the
 * real, permanent resting state for every Ready dataset until someone
 * clicks a real "Train Model" button. Not terminal (isTerminalTrainingStatus
 * is false for it), so callers must check this FIRST: treating "not_started"
 * as "non-terminal -> still running" was a real bug - it showed a fake,
 * permanently-stuck "Training… 0%" pill with no way to ever start a real run.
 */
export function isNotStartedTrainingStatus(status: string): boolean {
  return NOT_STARTED_TRAINING_STATUSES.includes(status.toLowerCase());
}

/** True for any status name that looks like a failure, so the UI can show an error state rather than treating it as a quiet success. */
export function isFailedTrainingStatus(status: string): boolean {
  return ['failed', 'error'].includes(status.toLowerCase());
}

/**
 * Real endpoint, confirmed working 2026-08-13. As of today (Anas, real
 * policy change), train/status/results never fall back to fake numbers
 * anymore - that fallback was deleted from the backend entirely, not just
 * disabled, so `results.mock` can never come back `true`. The four named
 * fields below are the confirmed real shape; `[key: string]: unknown` keeps
 * this forward-compatible with any field not yet documented, same honesty
 * rule as before.
 */
export interface ModelConfidence extends Record<string, unknown> {
  overall_accuracy_percent?: number;
  r_squared?: number;
}

export interface ChannelContributionRow extends Record<string, unknown> {
  pct_of_contribution?: number;
  incremental_outcome?: number;
}

export type ChannelEfficiencyRow = Record<string, unknown>;

/** Real field per Hammad's 2026-09-02 handover, same for both engines - exact shape still undocumented beyond "flags a channel," so kept as loosely-typed as channel_efficiency above until a real response confirms its fields. */
export type DataQualityFlagRow = Record<string, unknown>;

/** Real field, added 2026-08-24 - one point per real date in the dataset, so the model's fit can be charted against what actually happened instead of just summarized in a single accuracy percent. */
export interface ActualVsPredictedPoint {
  date: string;
  actual: number;
  predicted: number;
}

/** Real field, added 2026-08-24 - a real range around each channel's ROI point-estimate, not just the single number channel_efficiency already has. */
export interface ChannelConfidenceRow {
  channel: string;
  roi_low: number;
  roi_high: number;
  confidence_percent: number;
}

/** Real field, added 2026-08-24 - what would have happened with zero marketing vs. what marketing actually added. */
export interface BaselineVsMarketing {
  baseline_outcome: number;
  marketing_outcome: number;
  baseline_percent: number;
  marketing_percent: number;
}

export interface TrainingResults extends Record<string, unknown> {
  model_confidence?: ModelConfidence;
  channel_contribution?: ChannelContributionRow[];
  channel_efficiency?: ChannelEfficiencyRow[];
  budget_recommendation?: unknown;
  /** Optional - only present on runs completed after 2026-08-24; check for presence before rendering. */
  actual_vs_predicted?: ActualVsPredictedPoint[];
  /** Optional - only present on runs completed after 2026-08-24; check for presence before rendering. */
  channel_confidence?: ChannelConfidenceRow[];
  /** Optional - only present on runs completed after 2026-08-24; check for presence before rendering. */
  baseline_vs_marketing?: BaselineVsMarketing;
  /** Real field per Hammad's 2026-09-02 handover - present for both Meridian and PyMC runs. */
  data_quality_flags?: DataQualityFlagRow[];
}

/**
 * `list`/`upload` still have no real backend (API-REFERENCE.md, "What is
 * not built yet") and stay honest about that. The four `save*` methods,
 * `getDataset()`, and the three train* methods below ARE real - each a thin
 * PATCH/GET/POST against `/datasets/:id/...`, all requiring the dataset's
 * own id (not the project's), matching what the backend actually scopes
 * them by.
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

  /**
   * Real endpoint, shipped alongside combine-columns - one real object per
   * uploaded row, numbers as numbers. Replaces the "Example data" placeholders
   * on Upload Data's preview and Optimize's timeframe chart/correlation
   * table/spend-share bars.
   */
  getRows(datasetId: string): Observable<RowsResponse> {
    return this.http.get<RowsResponse>(`${environment.apiBaseUrl}/datasets/${datasetId}/rows`);
  }

  /**
   * Real endpoint - a real summed series per date for the given columns.
   * Requires Configuration to already be saved (needs the real date column
   * to group by), same requirement Optimize's date-range already has.
   */
  combineColumns(datasetId: string, columns: string[]): Observable<CombineColumnsResponse> {
    return this.http.post<CombineColumnsResponse>(`${environment.apiBaseUrl}/datasets/${datasetId}/combine-columns`, {
      columns,
    });
  }

  /**
   * Real endpoint - the one that actually changes what trains, not just
   * what the chart previews. See CombineChannelsResponse for the real side
   * effect (clears channelHyperparameters) callers must surface.
   */
  combineChannels(datasetId: string, sourceColumns: string[], newColumnName: string): Observable<CombineChannelsResponse> {
    return this.http.patch<CombineChannelsResponse>(`${environment.apiBaseUrl}/datasets/${datasetId}/combine-channels`, {
      sourceColumns,
      newColumnName,
    });
  }

  /** Real endpoint - finds and combines every real 90%+ correlated group of media columns in one call. No body needed. */
  autoCombineChannels(datasetId: string): Observable<AutoCombineChannelsResponse> {
    return this.http.post<AutoCombineChannelsResponse>(`${environment.apiBaseUrl}/datasets/${datasetId}/auto-combine-channels`, {});
  }

  /**
   * Real endpoint - the real min/max date found in the uploaded file, used
   * to suggest a training date range on Optimize instead of leaving the
   * user to guess. Requires Configuration to already be saved (needs the
   * real date column) - throws a clear 400 otherwise, which is expected,
   * not a bug: optimizeContextGuard's own step order already prevents
   * reaching Optimize before Configure is saved.
   */
  getDateRange(datasetId: string): Observable<DateRangeResponse> {
    return this.http.get<DateRangeResponse>(`${environment.apiBaseUrl}/datasets/${datasetId}/date-range`);
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

  /** Real endpoint, confirmed working 2026-08-13 - starts training for a Ready (fully configured) dataset. */
  trainModel(datasetId: string): Observable<TrainModelResponse> {
    return this.http.post<TrainModelResponse>(`${environment.apiBaseUrl}/datasets/${datasetId}/train`, {});
  }

  /** Real endpoint, confirmed working 2026-08-13 - poll this after trainModel() until isTerminalTrainingStatus() is true. */
  getTrainingStatus(datasetId: string): Observable<TrainingStatusResponse> {
    return this.http.get<TrainingStatusResponse>(`${environment.apiBaseUrl}/datasets/${datasetId}/status`);
  }

  /** Real endpoint, confirmed working 2026-08-13 - always real trained-model output now (no more mock fallback). A real error here means exactly what it says: training isn't done yet, or the engine couldn't be reached - the caller should show the real message, not assume a specific reason. */
  getResults(datasetId: string): Observable<TrainingResults> {
    return this.http.get<TrainingResults>(`${environment.apiBaseUrl}/datasets/${datasetId}/results`);
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
