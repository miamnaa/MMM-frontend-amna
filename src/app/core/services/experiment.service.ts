import { Injectable } from '@angular/core';
import { Observable, of, throwError } from 'rxjs';

import {
  Experiment,
  ExperimentResult,
  ModelConfig,
  Scenario,
} from '../models/domain.models';

const notAvailable = () =>
  throwError(() => new Error('Experiments are not connected to a backend yet.'));

/**
 * No /experiments, /jobs or /scenarios route exists on the real API yet
 * (API-REFERENCE.md, "What is not built yet"). Reads return empty rather
 * than fabricated rows; writes fail loudly instead of faking a success that
 * never happened. Once these routes ship, replace these bodies with real
 * HttpClient calls - see ProjectService for the exact shape to copy.
 */
@Injectable({ providedIn: 'root' })
export class ExperimentService {
  list(_projectId?: string): Observable<Experiment[]> {
    return of([]);
  }

  get(_id: string): Observable<Experiment | undefined> {
    return of(undefined);
  }

  saveConfig(_id: string, _config: ModelConfig): Observable<Experiment> {
    return notAvailable();
  }

  run(_id: string): Observable<Experiment> {
    return notAvailable();
  }

  logs(_id: string): Observable<string[]> {
    return of([]);
  }

  results(_id: string): Observable<ExperimentResult | undefined> {
    return of(undefined);
  }

  scenarios(_experimentId?: string): Observable<Scenario[]> {
    return of([]);
  }
}
