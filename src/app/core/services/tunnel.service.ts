import { Injectable, signal } from '@angular/core';

export interface TunnelDataset {
  id: string;
  name: string;
  modelType: string;
  /** True when the real upload call failed and this is a local placeholder standing in for it. */
  local: boolean;
}

/**
 * In-memory only, on purpose - Configure has no real backend yet
 * (CMP-79), so "did Upload Data actually happen this session" can't be
 * checked against anything but this. Resets on a fresh tab, same as the
 * OTP-verified flag resets differently (sessionStorage) because that one
 * guards a real security step and this one doesn't.
 */
@Injectable({ providedIn: 'root' })
export class TunnelService {
  readonly projectId = signal<string | null>(null);
  readonly dataset = signal<TunnelDataset | null>(null);

  selectProject(id: string): void {
    // A dataset picked for a different project shouldn't silently carry
    // over if someone backs out and picks a different one.
    if (this.projectId() !== id) this.dataset.set(null);
    this.projectId.set(id);
  }

  setDataset(dataset: TunnelDataset): void {
    this.dataset.set(dataset);
  }

  reset(): void {
    this.projectId.set(null);
    this.dataset.set(null);
  }
}
