import { createStageGuard } from './stage-context-guard';

/** Calibrate requires Optimize to have actually been saved first - see stage-context-guard.ts. */
export const calibrateContextGuard = createStageGuard('optimize');
