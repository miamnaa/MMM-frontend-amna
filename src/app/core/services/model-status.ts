import { ApiProjectDataset } from './dataset.service';
import { TunnelService } from './tunnel.service';

export type ModelStatus = 'uploaded' | 'configured' | 'ready';

export const MODEL_STATUS_META: Record<ModelStatus, { label: string; percent: number }> = {
  uploaded: { label: 'Uploaded', percent: 33 },
  configured: { label: 'Configured', percent: 66 },
  ready: { label: 'Ready', percent: 100 },
};

/**
 * Status is computed purely from presence (null vs. not) - see
 * ApiProjectDataset for what's assumed about the shape. Only tracks
 * `columnMapping` and `dateRange`, not `calibration`/
 * `channelHyperparameters` - real bug, fixed 2026-09-08: Calibrate and
 * Hyperparameterization are both genuinely optional per Hammad's real
 * contract, and Assemble/Train only requires Configure + Optimize. A real
 * deliberate "skip" on either optional step saves that field as `null`,
 * which is indistinguishable from "the user never visited this screen at
 * all" - the backend has no way to tell them apart. Treating null as "not
 * done" (the previous behavior) meant a real, on-purpose skip of
 * Calibrate looped the user straight back into it every time they
 * reopened the model, forever stuck below 100%. Since neither field can
 * be trusted to mean "incomplete," status only tracks the two steps that
 * are actually required and actually provable from the data.
 */
export function computeModelStatus(d: ApiProjectDataset): ModelStatus {
  if (d.columnMapping === null) return 'uploaded';
  if (d.dateRange === null) return 'configured';
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
 * the next incomplete required step, or Optimize (the last step that's
 * actually required and provably done, with every real saved stage already
 * loaded) once Configure + Optimize are both done. Calibrate and
 * Hyperparameterization stay reachable from there via each screen's own
 * real Save/Continue - this never forces either one, since neither is
 * required and neither can be reliably proven "already done" vs.
 * "on-purpose skipped." Shared by the Projects page's eye icon and the
 * Models list's Continue Setup/Edit buttons - same "jump back into this
 * model's build screens" behavior either way.
 *
 * Real bug, fixed 2026-09-11: a 'ready' dataset used to always land back on
 * Configure - the very first tunnel screen - even for someone who'd already
 * gone all the way through Calibrate/Hyperparameters. Nothing was actually
 * lost (Configure re-fetches and correctly re-fills the real saved values),
 * but resuming several steps further back than where you'd actually been
 * reads exactly like "my progress didn't save." Optimize is one step later
 * and still always safe to land on, since it's the last stage this
 * function can prove is real.
 */
export function resumeDatasetRoute(
  tunnelService: TunnelService,
  projectId: string,
  dataset: ApiProjectDataset,
): string[] {
  const status = computeModelStatus(dataset);
  loadDatasetIntoTunnel(tunnelService, projectId, dataset);

  if (status === 'uploaded') return ['/configure', projectId, dataset.id];

  // 'configured' or 'ready' - Optimize only requires Configure to be done,
  // and is the furthest stage this function can prove is real either way.
  return ['/optimize', projectId, dataset.id];
}
