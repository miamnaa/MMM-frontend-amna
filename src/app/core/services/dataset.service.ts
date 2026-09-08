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

/**
 * Mirrors the real PATCH /datasets/:id/hyperparameters body - confirmed
 * against Hammad's real contract 2026-09-08. A channel entry can have
 * `carryover` only, `saturation` only, or both - never neither (a channel
 * with nothing set is rejected, so leave it out of the array instead).
 * `saturation`, when present, must be strictly greater than 0 (was >= 0
 * before).
 */
export interface HyperparameterChannel {
  channel: string;
  carryover?: number;
  saturation?: number;
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

/**
 * Real endpoint: GET /datasets/:id/data-quality, added 2026-09-07 - the fix
 * for real data problems (a bad date format, blank cells, negative spend)
 * only ever surfacing at Train, after every earlier step was already
 * filled in. Callable before Configure is even saved (runs against the
 * suggested column mapping until a real one is saved, then the real one) -
 * an `error` flag is a real blocker (nothing past Configure should be
 * reachable while one exists), a `warning` is a dismissible real notice,
 * not a hard stop.
 */
export interface DataQualityFlag {
  severity: 'error' | 'warning';
  message: string;
  columnsInvolved: string[];
}

export interface DataQualityResponse {
  flags: DataQualityFlag[];
}

/**
 * Real endpoint: GET /datasets/:id/channel-health, added 2026-09-07 -
 * replaces the client-side VIF/correlation math Optimize's Channel Health
 * used to compute itself. Requires Configuration to already be saved (400s
 * otherwise, same pattern as getDateRange).
 *
 * `vif` was originally null for two different real reasons - as of Anas's
 * 2026-09-07 update, one of those got a real fix: exact collinearity
 * between two other channels (a plain regression has no unique answer)
 * now returns a real ridge-regularized VIF instead, flagged via
 * `vifIsApproximate: true` so the UI can give it a slightly softer real
 * caveat than a plain VIF gets. `vif` is still genuinely `null` for the
 * two structural cases regularizing can't fix: only one real media
 * channel exists (nothing to compare against), or fewer real rows than
 * channels (not enough data for a stable fit at all) - still "not enough
 * data to tell," never treated as zero/healthy.
 */
export interface ChannelHealthApiRow {
  channel: string;
  shareOfSpendPercent: number;
  vif: number | null;
  /** True when `vif` came from the real ridge-regularized fallback, not the plain textbook formula - still a real, computed number. */
  vifIsApproximate: boolean;
  mostCorrelatedWith: string | null;
  mostCorrelatedValue: number | null;
}

export interface ChannelHealthResponse {
  channels: ChannelHealthApiRow[];
}

/**
 * Real endpoint: GET /datasets/:id/exposure-metrics, added 2026-09-07 -
 * requires Configuration to already be saved. Covers every real control
 * AND organic column from Configure, not just control - one call for both
 * groups. `suggestedDirection` is already computed backend-side from a
 * real correlation against the target column ('not_sure' when the real
 * correlation is weaker than 0.1 in either direction) - `correlation` is
 * only there if a caller wants to show the raw strength, not required for
 * the pre-selected pill.
 */
export interface ExposureMetricRow {
  column: string;
  correlation: number;
  suggestedDirection: 'helps' | 'hurts' | 'not_sure';
}

export interface ExposureMetricsResponse {
  metrics: ExposureMetricRow[];
}

export interface ExposureDirection {
  column: string;
  direction: 'helps' | 'hurts' | 'not_sure';
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
  /** Per Hammad's Model Performance Developer Reference (2026-09-02+) - already a percent, display directly. Not yet confirmed present on a live response. */
  average_error_percent?: number;
  /** Per the same reference - arrives 0-1 like r_squared, multiply by 100. UI label must read "Trust-checked score," never "Adjusted R-squared." Not yet confirmed present on a live response. */
  adjusted_r_squared?: number;
}

export interface ChannelContributionRow extends Record<string, unknown> {
  pct_of_contribution?: number;
  incremental_outcome?: number;
  /** Real field per the Business Insights Developer Reference v2 (2026-09-04) - this channel's real spend, same figure combine/VIF math elsewhere reads from getRows(), just pre-aggregated server-side here. */
  spend?: number;
  /** Real field, same reference - this channel's spend as a % of total real spend across every channel in this array. */
  pct_of_spend?: number;
}

/** roi/marginal_roi confirmed as the real field names by the Business Insights Developer Reference v2 (2026-09-04) - kept open-ended beyond those two since the rest of the row's shape still isn't fully documented. */
export interface ChannelEfficiencyRow extends Record<string, unknown> {
  roi?: number;
  marginal_roi?: number;
}

/**
 * Real field per Hammad's 2026-09-02 handover, same for both engines. The
 * Business Insights Developer Reference v2 additionally confirms a real
 * `columns_involved: string[]` field on each flag row - the list of channel
 * names that flag covers - used to warn a channel is low-spend/limited
 * history. Kept as a loosely-typed record beyond that one confirmed field,
 * since the rest of the row's shape isn't documented.
 */
export interface DataQualityFlagRow extends Record<string, unknown> {
  columns_involved?: string[];
}

/** Real field per both Developer References (Model Performance + Business Insights) - shared context about the dataset itself, not any one chart. */
export interface DataUsed {
  media_columns: string[];
  row_count: number;
}

/**
 * Per Hammad's Model Performance Developer Reference - the exact shape
 * specified for the decay/saturation charts, but NOT yet part of a
 * confirmed live response (unlike model_confidence's two original fields).
 * Optional and speculative until a real response actually includes them -
 * model-performance-lab falls back to illustrative data whenever either is
 * absent.
 */
export interface AdstockDecayCurve {
  channel: string;
  curve: { weeks_since_spend: number; effect_remaining_percent: number }[];
}

export interface SaturationCurve {
  channel: string;
  curve: { spend_level: number; effect: number }[];
  historical_spend_distribution?: unknown;
}

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
  /** Real field per both Developer References - optional, not yet confirmed on a live response. */
  data_used?: DataUsed;
  /** Per Hammad's Model Performance Developer Reference - speculative, see AdstockDecayCurve. */
  adstock_decay_curves?: AdstockDecayCurve[];
  /** Per Hammad's Model Performance Developer Reference - speculative, see SaturationCurve. */
  saturation_curves?: SaturationCurve[];
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

  /** Real endpoint, added 2026-09-07 - callable right after upload, before Configure is even saved (runs against the suggested mapping until a real one exists). See DataQualityResponse for what a caller must do with `error` vs `warning` flags. */
  getDataQuality(datasetId: string): Observable<DataQualityResponse> {
    return this.http.get<DataQualityResponse>(`${environment.apiBaseUrl}/datasets/${datasetId}/data-quality`);
  }

  /** Real endpoint, added 2026-09-07 - requires Configuration to already be saved (400s otherwise). See ChannelHealthResponse for the real null-handling rule on vif/mostCorrelatedWith/mostCorrelatedValue. */
  getChannelHealth(datasetId: string): Observable<ChannelHealthResponse> {
    return this.http.get<ChannelHealthResponse>(`${environment.apiBaseUrl}/datasets/${datasetId}/channel-health`);
  }

  /** Real endpoint, added 2026-09-07 - requires Configuration to already be saved (400s otherwise), covers every real control + organic column in one call. */
  getExposureMetrics(datasetId: string): Observable<ExposureMetricsResponse> {
    return this.http.get<ExposureMetricsResponse>(`${environment.apiBaseUrl}/datasets/${datasetId}/exposure-metrics`);
  }

  /**
   * Real endpoint, added 2026-09-07. Must include every real control +
   * organic column from Configure, exactly once each - same "exactly
   * these, no more no fewer" rule Hyperparameterization already enforces
   * for media channels. Doesn't yet change a real training run's outcome
   * (a real open question for Hammad, per Anas) - it only records the
   * user's choice for now.
   */
  saveExposureDirections(datasetId: string, directions: ExposureDirection[]): Observable<unknown> {
    return this.http.patch(`${environment.apiBaseUrl}/datasets/${datasetId}/exposure-directions`, { directions });
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

  /**
   * Real endpoint: PATCH /datasets/:id/calibration (confirmed by Anas
   * 2026-09-08 - /calibrate was a real mistake in an earlier version of
   * this contract and threw a real "Cannot PATCH" error; /calibration is
   * the actual route). Behavior confirmed the same day: both fields are
   * optional, but only together. Sending just one now real-400s ("Provide
   * both contributionBeliefPercent and confidencePercent together, or
   * leave both out - not just one"). An empty body is a real, valid,
   * supported "no belief input" - not an error state - so callers must
   * send `{}`, never a placeholder 50/50 default, when there's genuinely
   * no belief to record.
   */
  saveCalibration(datasetId: string, body: Partial<SavedCalibration>): Observable<unknown> {
    return this.http.patch(`${environment.apiBaseUrl}/datasets/${datasetId}/calibration`, body);
  }

  /**
   * Real endpoint: PATCH /datasets/:id/hyperparameters (confirmed by Anas
   * 2026-09-08 - /hyperparameterize was the same real routing mistake as
   * /calibrate above; /hyperparameters is the actual route). Behavior
   * confirmed the same day: requires Configuration to already be saved - a
   * channel name that isn't one of this dataset's real media columns is
   * rejected, same as before. Unlike before, `channels` no longer has to
   * cover every real media column (`[]` is valid) - each entry can have
   * carryover only, saturation only, or both, but never neither. Callers
   * must leave an untouched channel out of the array entirely rather than
   * sending it with no fields set.
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
