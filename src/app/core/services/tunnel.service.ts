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
  revenuePerKpiValue?: number;
  mediaColumns: string[];
  controlColumns: string[];
  organicColumns: string[];
  geoColumns: string[];
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

  /**
   * Optimize's real remove/combine undo history - lives here rather than on
   * the Optimize component itself so it survives leaving and coming back
   * (e.g. Optimize -> Calibrate -> back to Optimize), which would otherwise
   * destroy and recreate the component and silently lose it. Still
   * in-memory only, same as everything else here - no real "channel change
   * history" endpoint exists to hydrate it from, so it's still gone on a
   * fresh tab, just not on in-tunnel navigation.
   */
  readonly channelChangeHistory = signal<{ id: string; summary: string; previousMediaColumns: string[] }[]>([]);

  selectProject(id: string): void {
    // A dataset (and everything saved against it) picked for a different
    // project shouldn't silently carry over if someone backs out and picks
    // a different one.
    if (this.projectId() !== id) {
      this.dataset.set(null);
      this.configuration.set(null);
      this.optimize.set(null);
      this.calibration.set(null);
      this.channelChangeHistory.set([]);
    }
    this.projectId.set(id);
  }

  setDataset(dataset: TunnelDataset): void {
    // A dataset switch within the same project (e.g. resuming a different
    // model from the Models list) shouldn't carry the previous dataset's
    // undo history along - it describes changes to a different set of
    // mediaColumns entirely.
    if (this.dataset()?.id !== dataset.id) {
      this.channelChangeHistory.set([]);
    }
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

  /** Real "no belief input" state (Save with the toggle off, per the real PATCH /datasets/:id/calibration contract) - distinct from setCalibration(), which asserts an actual saved belief/confidence pair. */
  clearCalibration(): void {
    this.calibration.set(null);
  }

  /**
   * Clears whichever dataset was previously selected/edited within the
   * *same* project - selectProject() alone doesn't do this, since it only
   * clears on an actual project change. Needed for "+ New model": starting
   * a new model in the same project you were just editing another one in
   * must not carry that other dataset's name/type/saved stages into the
   * fresh Upload Data screen.
   */
  clearDataset(): void {
    this.dataset.set(null);
    this.configuration.set(null);
    this.optimize.set(null);
    this.calibration.set(null);
    this.channelChangeHistory.set([]);
  }

  reset(): void {
    this.projectId.set(null);
    this.dataset.set(null);
    this.configuration.set(null);
    this.optimize.set(null);
    this.calibration.set(null);
    this.channelChangeHistory.set([]);
  }
}
