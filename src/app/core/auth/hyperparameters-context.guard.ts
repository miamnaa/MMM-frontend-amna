import { createStageGuard } from './stage-context-guard';

/**
 * Hyperparameters requires Calibration to have actually been saved first -
 * see stage-context-guard.ts. This is also what guarantees the channel list
 * on this screen always has real, saved mediaColumns to pre-fill from - you
 * cannot reach it without Configure having been saved somewhere upstream.
 */
export const hyperparametersContextGuard = createStageGuard('calibration');
