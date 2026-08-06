/**
 * Domain types mirroring the platform's PostgreSQL schema.
 * These are the contract the UI codes against; the HTTP layer maps onto them.
 */

export type ModelingEngine = 'meridian' | 'pymc';

export type ExperimentStatus =
  | 'draft'
  | 'configured'
  | 'queued'
  | 'running'
  | 'completed'
  | 'failed';

export type ValidationStatus = 'pending' | 'valid' | 'invalid';

export type UserRole = 'admin' | 'analyst' | 'viewer';

export interface User {
  id: string;
  name: string;
  email: string;
  role: UserRole;
  initials: string;
}

export interface Project {
  id: string;
  name: string;
  description: string;
  engine: ModelingEngine;
  createdAt: string;
  updatedAt: string;
  ownerName: string;
  experimentCount: number;
  datasetCount: number;
}

export interface DatasetColumn {
  name: string;
  type: 'date' | 'numeric' | 'text';
  role: 'date' | 'kpi' | 'media_spend' | 'media_impressions' | 'control' | 'unassigned';
  nullCount: number;
}

export interface DatasetIssue {
  column: string;
  message: string;
}

export interface Dataset {
  id: string;
  projectId: string;
  name: string;
  fileName: string;
  sizeBytes: number;
  rowCount: number;
  uploadedAt: string;
  uploadedBy: string;
  validationStatus: ValidationStatus;
  columns: DatasetColumn[];
  issues: DatasetIssue[];
  dateRange: { start: string; end: string } | null;
}

export interface AdstockConfig {
  maxLag: number;
  decay: number;
}

export interface SaturationConfig {
  type: 'hill' | 'logistic' | 'none';
  halfSaturation: number;
}

export interface ModelConfig {
  engine: ModelingEngine;
  kpiColumn: string;
  dateColumn: string;
  mediaColumns: string[];
  controlColumns: string[];
  adstock: AdstockConfig;
  saturation: SaturationConfig;
  seasonality: boolean;
  trainTestSplit: number;
  chains: number;
  draws: number;
  tuneSteps: number;
}

export interface Experiment {
  id: string;
  projectId: string;
  projectName: string;
  datasetId: string | null;
  name: string;
  status: ExperimentStatus;
  engine: ModelingEngine;
  createdAt: string;
  startedAt: string | null;
  completedAt: string | null;
  durationSeconds: number | null;
  progress: number;
  errorMessage: string | null;
  config: ModelConfig | null;
}

export interface LogLine {
  timestamp: string;
  level: 'info' | 'warn' | 'error';
  message: string;
}

export interface ChannelContribution {
  channel: string;
  contribution: number;
  spend: number;
  roi: number;
  cpa: number;
}

export interface ResponseCurvePoint {
  spend: number;
  response: number;
}

export interface ResponseCurve {
  channel: string;
  points: ResponseCurvePoint[];
  currentSpend: number;
  saturationPoint: number;
}

export interface ModelMetrics {
  rSquared: number;
  mape: number;
  rmse: number;
  nrmse: number;
  rhatMax: number;
  divergences: number;
}

export interface ExperimentResult {
  experimentId: string;
  metrics: ModelMetrics;
  contributions: ChannelContribution[];
  responseCurves: ResponseCurve[];
  baselineContribution: number;
  totalRevenue: number;
  totalSpend: number;
}

export interface ScenarioAllocation {
  channel: string;
  currentSpend: number;
  proposedSpend: number;
  predictedRevenue: number;
}

export interface Scenario {
  id: string;
  experimentId: string;
  name: string;
  totalBudget: number;
  createdAt: string;
  allocations: ScenarioAllocation[];
  predictedLift: number;
}

export interface AppNotification {
  id: string;
  title: string;
  body: string;
  createdAt: string;
  read: boolean;
  kind: 'success' | 'error' | 'info';
}
