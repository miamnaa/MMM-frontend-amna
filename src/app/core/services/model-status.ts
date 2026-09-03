import { ApiProjectDataset } from './dataset.service';
import { TunnelService } from './tunnel.service';

export type ModelStatus = 'uploaded' | 'configured' | 'optimized' | 'calibrated' | 'ready';

export const MODEL_STATUS_META: Record<ModelStatus, { label: string; percent: number }> = {
  uploaded: { label: 'Uploaded', percent: 20 },
  configured: { label: 'Configured', percent: 40 },
  optimized: { label: 'Optimized', percent: 60 },
  calibrated: { label: 'Calibrated', percent: 80 },
  ready: { label: 'Ready', percent: 100 },
};

/** Status is computed purely from presence (null vs. not) - see ApiProjectDataset for what's assumed about the shape. */
export function computeModelStatus(d: ApiProjectDataset): ModelStatus {
  if (d.columnMapping === null) return 'uploaded';
  if (d.dateRange === null) return 'configured';
  if (d.calibration === null) return 'optimized';
  if (d.channelHyperparameters === null) return 'calibrated';
  return 'ready';
}

/**
 * Loads every saved stage of `dataset` into TunnelService, so route guards
 * see it as already in progress - used both when resuming from a list
 * (Projects/Models) and when a context guard rebuilds this state after a
 * page reload wiped it (see stage-context-guard.ts).
 */
export function loadDatasetIntoTunnel(
  tunnelService: TunnelService,
  projectId: string,
  dataset: ApiProjectDataset,
): void {
  tunnelService.selectProject(projectId);
  tunnelService.setDataset({
    id: dataset.id,
    name: dataset.name,
    modelType: dataset.modelType ?? '',
    local: false,
  });
  if (dataset.columnMapping) tunnelService.setConfiguration(dataset.columnMapping);
  if (dataset.dateRange) tunnelService.setOptimize(dataset.dateRange);
  if (dataset.calibration) tunnelService.setCalibration(dataset.calibration);
}

/**
 * Returns the router.navigate() commands for wherever `dataset` should open -
 * the next incomplete step, or Configure (fully editable from there, since
 * every stage is now loaded) if it's already Ready. Shared by the Projects
 * page's eye icon and the Models list's Continue Setup/Edit buttons - same
 * "jump back into this model's build screens" behavior either way.
 */
export function resumeDatasetRoute(
  tunnelService: TunnelService,
  projectId: string,
  dataset: ApiProjectDataset,
): string[] {
  const status = computeModelStatus(dataset);
  loadDatasetIntoTunnel(tunnelService, projectId, dataset);

  if (status === 'uploaded') return ['/configure', projectId, dataset.id];
  if (status === 'configured') return ['/optimize', projectId, dataset.id];
  if (status === 'optimized') return ['/calibrate', projectId, dataset.id];
  if (status === 'calibrated') return ['/hyperparameters', projectId, dataset.id];

  // 'ready' - stays fully editable; start at Configure now that every stage is loaded.
  return ['/configure', projectId, dataset.id];
}
