import { Injectable } from '@angular/core';
import { Observable, of, throwError } from 'rxjs';

import { Dataset } from '../models/domain.models';

const notAvailable = () =>
  throwError(() => new Error('Datasets are not connected to a backend yet.'));

/**
 * No /datasets route exists on the real API yet (API-REFERENCE.md, "What is
 * not built yet"). Reads return empty rather than fabricated rows; writes
 * fail loudly instead of faking a success that never happened. Once the
 * route ships, replace these bodies with real HttpClient calls - see
 * ProjectService for the exact shape to copy.
 */
@Injectable({ providedIn: 'root' })
export class DatasetService {
  list(_projectId?: string): Observable<Dataset[]> {
    return of([]);
  }

  get(_id: string): Observable<Dataset | undefined> {
    return of(undefined);
  }

  upload(_file: File, _projectId: string): Observable<Dataset> {
    return notAvailable();
  }

  remove(_id: string): Observable<void> {
    return notAvailable();
  }
}
