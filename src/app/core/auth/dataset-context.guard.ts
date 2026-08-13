import { createStageGuard } from './stage-context-guard';

/**
 * Configure only needs a dataset actually selected for this project - see
 * stage-context-guard.ts for how this survives a page reload, not just an
 * in-memory same-tab check.
 */
export const datasetContextGuard = createStageGuard('dataset');
