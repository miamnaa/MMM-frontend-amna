import { createStageGuard } from './stage-context-guard';

/** Optimize requires Configure to have actually been saved first - see stage-context-guard.ts. */
export const optimizeContextGuard = createStageGuard('configuration');
