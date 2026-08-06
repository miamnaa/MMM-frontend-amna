import {
  AppNotification,
  Dataset,
  Experiment,
  ExperimentResult,
  ModelConfig,
  Project,
  ResponseCurve,
  Scenario,
  User,
} from '../models/domain.models';

export const CURRENT_USER: User = {
  id: 'u-1',
  name: 'Amna Minhas',
  email: 'amna@convergentbt.com',
  role: 'admin',
  initials: 'AM',
};

export const PROJECTS: Project[] = [
  {
    id: 'p-1',
    name: 'Retail FY26 Media Mix',
    description: 'Full-funnel MMM across paid search, social, TV and retail media.',
    engine: 'meridian',
    createdAt: '2026-06-02T09:12:00Z',
    updatedAt: '2026-08-04T14:30:00Z',
    ownerName: 'Amna Minhas',
    experimentCount: 6,
    datasetCount: 3,
  },
  {
    id: 'p-2',
    name: 'DTC Brand Launch',
    description: 'Incrementality read for the Q3 direct-to-consumer launch.',
    engine: 'pymc',
    createdAt: '2026-07-11T11:00:00Z',
    updatedAt: '2026-08-05T08:45:00Z',
    ownerName: 'Hammad Ahmed',
    experimentCount: 3,
    datasetCount: 2,
  },
  {
    id: 'p-3',
    name: 'Regional Spend Efficiency',
    description: 'Geo-level model comparing efficiency across five regions.',
    engine: 'meridian',
    createdAt: '2026-07-28T15:20:00Z',
    updatedAt: '2026-08-01T10:05:00Z',
    ownerName: 'Muhammad Anas',
    experimentCount: 2,
    datasetCount: 1,
  },
];

export const DATASETS: Dataset[] = [
  {
    id: 'd-1',
    projectId: 'p-1',
    name: 'Weekly media spend 2024-2026',
    fileName: 'retail_weekly_spend.csv',
    sizeBytes: 4_812_003,
    rowCount: 1_248,
    uploadedAt: '2026-07-30T10:02:00Z',
    uploadedBy: 'Amna Minhas',
    validationStatus: 'valid',
    dateRange: { start: '2024-01-01', end: '2026-06-28' },
    issues: [],
    columns: [
      { name: 'week', type: 'date', role: 'date', nullCount: 0 },
      { name: 'revenue', type: 'numeric', role: 'kpi', nullCount: 0 },
      { name: 'search_spend', type: 'numeric', role: 'media_spend', nullCount: 0 },
      { name: 'social_spend', type: 'numeric', role: 'media_spend', nullCount: 2 },
      { name: 'tv_spend', type: 'numeric', role: 'media_spend', nullCount: 0 },
      { name: 'retail_media_spend', type: 'numeric', role: 'media_spend', nullCount: 0 },
      { name: 'price_index', type: 'numeric', role: 'control', nullCount: 0 },
      { name: 'promo_flag', type: 'numeric', role: 'control', nullCount: 0 },
    ],
  },
  {
    id: 'd-2',
    projectId: 'p-1',
    name: 'Impressions feed Q1-Q2',
    fileName: 'impressions_q1_q2.csv',
    sizeBytes: 2_140_776,
    rowCount: 812,
    uploadedAt: '2026-08-02T13:44:00Z',
    uploadedBy: 'Muhammad Anas',
    validationStatus: 'invalid',
    dateRange: null,
    issues: [
      { column: 'week_start', message: 'Expected ISO date format, found "03/14/2026".' },
      { column: 'revenue', message: 'Required KPI column is missing.' },
      { column: 'tv_impressions', message: '46 null values in a media column.' },
    ],
    columns: [
      { name: 'week_start', type: 'text', role: 'unassigned', nullCount: 0 },
      { name: 'search_impressions', type: 'numeric', role: 'media_impressions', nullCount: 0 },
      { name: 'tv_impressions', type: 'numeric', role: 'media_impressions', nullCount: 46 },
    ],
  },
  {
    id: 'd-3',
    projectId: 'p-2',
    name: 'DTC launch weekly panel',
    fileName: 'dtc_launch_panel.csv',
    sizeBytes: 1_002_411,
    rowCount: 416,
    uploadedAt: '2026-08-05T09:15:00Z',
    uploadedBy: 'Hammad Ahmed',
    validationStatus: 'pending',
    dateRange: { start: '2025-09-01', end: '2026-07-05' },
    issues: [],
    columns: [
      { name: 'week', type: 'date', role: 'date', nullCount: 0 },
      { name: 'orders', type: 'numeric', role: 'kpi', nullCount: 0 },
      { name: 'meta_spend', type: 'numeric', role: 'media_spend', nullCount: 0 },
      { name: 'tiktok_spend', type: 'numeric', role: 'media_spend', nullCount: 0 },
    ],
  },
];

const BASE_CONFIG: ModelConfig = {
  engine: 'meridian',
  kpiColumn: 'revenue',
  dateColumn: 'week',
  mediaColumns: ['search_spend', 'social_spend', 'tv_spend', 'retail_media_spend'],
  controlColumns: ['price_index', 'promo_flag'],
  adstock: { maxLag: 8, decay: 0.6 },
  saturation: { type: 'hill', halfSaturation: 0.5 },
  seasonality: true,
  trainTestSplit: 0.8,
  chains: 4,
  draws: 1000,
  tuneSteps: 500,
};

export const EXPERIMENTS: Experiment[] = [
  {
    id: 'e-1',
    projectId: 'p-1',
    projectName: 'Retail FY26 Media Mix',
    datasetId: 'd-1',
    name: 'Baseline hill saturation',
    status: 'completed',
    engine: 'meridian',
    createdAt: '2026-08-01T09:00:00Z',
    startedAt: '2026-08-01T09:04:00Z',
    completedAt: '2026-08-01T09:41:00Z',
    durationSeconds: 2_220,
    progress: 100,
    errorMessage: null,
    config: BASE_CONFIG,
  },
  {
    id: 'e-2',
    projectId: 'p-1',
    projectName: 'Retail FY26 Media Mix',
    datasetId: 'd-1',
    name: 'Longer adstock, 12 week lag',
    status: 'running',
    engine: 'meridian',
    createdAt: '2026-08-06T08:10:00Z',
    startedAt: '2026-08-06T08:12:00Z',
    completedAt: null,
    durationSeconds: null,
    progress: 62,
    errorMessage: null,
    config: { ...BASE_CONFIG, adstock: { maxLag: 12, decay: 0.72 } },
  },
  {
    id: 'e-3',
    projectId: 'p-2',
    projectName: 'DTC Brand Launch',
    datasetId: 'd-3',
    name: 'PyMC orders model v1',
    status: 'queued',
    engine: 'pymc',
    createdAt: '2026-08-06T08:30:00Z',
    startedAt: null,
    completedAt: null,
    durationSeconds: null,
    progress: 0,
    errorMessage: null,
    config: { ...BASE_CONFIG, engine: 'pymc', kpiColumn: 'orders' },
  },
  {
    id: 'e-4',
    projectId: 'p-1',
    projectName: 'Retail FY26 Media Mix',
    datasetId: 'd-2',
    name: 'Impressions-based variant',
    status: 'failed',
    engine: 'meridian',
    createdAt: '2026-08-03T16:20:00Z',
    startedAt: '2026-08-03T16:22:00Z',
    completedAt: '2026-08-03T16:24:00Z',
    durationSeconds: 120,
    progress: 18,
    errorMessage: 'Dataset d-2 failed schema validation: KPI column "revenue" not found.',
    config: BASE_CONFIG,
  },
  {
    id: 'e-5',
    projectId: 'p-3',
    projectName: 'Regional Spend Efficiency',
    datasetId: null,
    name: 'Geo hierarchical draft',
    status: 'draft',
    engine: 'meridian',
    createdAt: '2026-08-05T12:00:00Z',
    startedAt: null,
    completedAt: null,
    durationSeconds: null,
    progress: 0,
    errorMessage: null,
    config: null,
  },
  {
    id: 'e-6',
    projectId: 'p-2',
    projectName: 'DTC Brand Launch',
    datasetId: 'd-3',
    name: 'No-seasonality control',
    status: 'configured',
    engine: 'pymc',
    createdAt: '2026-08-04T10:30:00Z',
    startedAt: null,
    completedAt: null,
    durationSeconds: null,
    progress: 0,
    errorMessage: null,
    config: { ...BASE_CONFIG, engine: 'pymc', seasonality: false },
  },
];

function buildCurve(current: number, saturation: number, ceiling: number): ResponseCurve['points'] {
  const points: ResponseCurve['points'] = [];
  const max = current * 2.2;
  for (let i = 0; i <= 24; i++) {
    const spend = (max / 24) * i;
    // Hill response: saturating returns as spend approaches the half-saturation point.
    const response = (ceiling * spend) / (saturation + spend);
    points.push({ spend: Math.round(spend), response: Math.round(response) });
  }
  return points;
}

export const RESULTS: Record<string, ExperimentResult> = {
  'e-1': {
    experimentId: 'e-1',
    metrics: {
      rSquared: 0.874,
      mape: 6.8,
      rmse: 41_302,
      nrmse: 0.072,
      rhatMax: 1.01,
      divergences: 0,
    },
    baselineContribution: 0.518,
    totalRevenue: 24_800_000,
    totalSpend: 5_420_000,
    contributions: [
      { channel: 'Paid search', contribution: 0.168, spend: 1_840_000, roi: 2.26, cpa: 18.4 },
      { channel: 'Paid social', contribution: 0.121, spend: 1_310_000, roi: 2.29, cpa: 21.1 },
      { channel: 'Television', contribution: 0.132, spend: 1_620_000, roi: 2.02, cpa: 29.7 },
      { channel: 'Retail media', contribution: 0.061, spend: 650_000, roi: 2.33, cpa: 16.2 },
    ],
    responseCurves: [
      {
        channel: 'Paid search',
        currentSpend: 1_840_000,
        saturationPoint: 2_400_000,
        points: buildCurve(1_840_000, 2_400_000, 5_600_000),
      },
      {
        channel: 'Paid social',
        currentSpend: 1_310_000,
        saturationPoint: 1_900_000,
        points: buildCurve(1_310_000, 1_900_000, 4_100_000),
      },
      {
        channel: 'Television',
        currentSpend: 1_620_000,
        saturationPoint: 3_100_000,
        points: buildCurve(1_620_000, 3_100_000, 5_200_000),
      },
      {
        channel: 'Retail media',
        currentSpend: 650_000,
        saturationPoint: 900_000,
        points: buildCurve(650_000, 900_000, 2_000_000),
      },
    ],
  },
};

export const SCENARIOS: Scenario[] = [
  {
    id: 's-1',
    experimentId: 'e-1',
    name: 'Shift 15% from TV to retail media',
    totalBudget: 5_420_000,
    createdAt: '2026-08-02T11:00:00Z',
    predictedLift: 0.043,
    allocations: [
      { channel: 'Paid search', currentSpend: 1_840_000, proposedSpend: 1_980_000, predictedRevenue: 4_470_000 },
      { channel: 'Paid social', currentSpend: 1_310_000, proposedSpend: 1_390_000, predictedRevenue: 3_180_000 },
      { channel: 'Television', currentSpend: 1_620_000, proposedSpend: 1_180_000, predictedRevenue: 2_390_000 },
      { channel: 'Retail media', currentSpend: 650_000, proposedSpend: 870_000, predictedRevenue: 2_020_000 },
    ],
  },
];

export const EXPERIMENT_LOGS: Record<string, string[]> = {
  'e-2': [
    'Worker picked up job from Azure Service Bus',
    'Loading dataset d-1 from blob storage (4.8 MB)',
    'Schema validated: 8 columns, 1248 rows',
    'Applying adstock transform, max lag 12, decay 0.72',
    'Applying hill saturation',
    'Sampling chain 1 of 4 — 1000 draws, 500 tune',
    'Sampling chain 2 of 4 — 1000 draws, 500 tune',
    'Sampling chain 3 of 4 — in progress',
  ],
};

export const NOTIFICATIONS: AppNotification[] = [
  {
    id: 'n-1',
    title: 'Run completed',
    body: '"Baseline hill saturation" finished in 37 minutes.',
    createdAt: '2026-08-01T09:41:00Z',
    read: false,
    kind: 'success',
  },
  {
    id: 'n-2',
    title: 'Run failed',
    body: '"Impressions-based variant" failed schema validation.',
    createdAt: '2026-08-03T16:24:00Z',
    read: false,
    kind: 'error',
  },
  {
    id: 'n-3',
    title: 'Dataset uploaded',
    body: 'Hammad Ahmed uploaded "DTC launch weekly panel".',
    createdAt: '2026-08-05T09:15:00Z',
    read: true,
    kind: 'info',
  },
];
