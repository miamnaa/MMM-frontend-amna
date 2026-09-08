import { createStageGuard } from './stage-context-guard';

/**
 * Hyperparameters requires Optimize to have actually been saved first -
 * see stage-context-guard.ts. Calibrate does NOT gate this screen, even
 * though it comes before it in the tunnel - Calibrate is real but
 * genuinely optional (Hammad's contract, confirmed 2026-09-08), and a
 * real deliberate "skip" there saves `calibration: null`, indistinguishable
 * from "never visited." Requiring it here caused a real bug: skipping
 * Calibrate on purpose looped the user straight back into it every time.
 * Hyperparameters only actually needs Configure's saved mediaColumns to
 * pre-fill from, which Optimize already guarantees exists upstream.
 */
export const hyperparametersContextGuard = createStageGuard('optimize');
