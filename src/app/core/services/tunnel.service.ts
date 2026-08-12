import { Injectable, signal } from '@angular/core';

export interface TunnelDataset {
  id: string;
  name: string;
  modelType: string;
  /** True when the real upload call failed and this is a local placeholder standing in for it. */
  local: boolean;
}

/** Mirrors the real PATCH /datasets/:id/configuration body exactly. */
export interface SavedConfiguration {
  dateColumn: string;
  targetColumn: string;
  kpiType: 'revenue' | 'non_revenue';
  mediaColumns: string[];
  controlColumns: string[];
  organicColumns: string[];
}

/** Mirrors the real PATCH /datasets/:id/optimize body. */
export interface SavedOptimize {
  startDate: string;
  endDate: string;
}

/** Mirrors the real PATCH /datasets/:id/calibration body. */
export interface SavedCalibration {
  contributionBeliefPercent: number;
  confidencePercent: number;
}

/**
 * In-memory only, on purpose - Configure/Optimize/Calibrate have no real
 * "am I done" read endpoint to check against, so "did this stage actually
 * happen this session" can't be checked against anything but this. Resets
 * on a fresh tab, same as the OTP-verified flag resets differently
 * (sessionStorage) because that one guards a real security step and this
 * one doesn't.
 */
@Injectable({ providedIn: 'root' })
export class TunnelService {
  readonly projectId = signal<string | null>(null);
  readonly dataset = signal<TunnelDataset | null>(null);
  readonly configuration = signal<SavedConfiguration | null>(null);
  readonly optimize = signal<SavedOptimize | null>(null);
  readonly calibration = signal<SavedCalibration | null>(null);

  selectProject(id: string): void {
    // A dataset (and everything saved against it) picked for a different
    // project shouldn't silently carry over if someone backs out and picks
    // a different one.
    if (this.projectId() !== id) {
      this.dataset.set(null);
      this.configuration.set(null);
      this.optimize.set(null);
      this.calibration.set(null);
    }
    this.projectId.set(id);
  }

  setDataset(dataset: TunnelDataset): void {
    this.dataset.set(dataset);
  }

  setConfiguration(configuration: SavedConfiguration): void {
    this.configuration.set(configuration);
  }

  setOptimize(optimize: SavedOptimize): void {
    this.optimize.set(optimize);
  }

  setCalibration(calibration: SavedCalibration): void {
    this.calibration.set(calibration);
  }

  reset(): void {
    this.projectId.set(null);
    this.dataset.set(null);
    this.configuration.set(null);
    this.optimize.set(null);
    this.calibration.set(null);
  }
}
