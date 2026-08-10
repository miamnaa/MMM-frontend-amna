import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable, delay, of } from 'rxjs';

import { environment } from '../../../environments/environment';
import { EXPERIMENTS, EXPERIMENT_LOGS, RESULTS, SCENARIOS } from '../mock/mock-data';
import {
  Experiment,
  ExperimentResult,
  ModelConfig,
  Scenario,
} from '../models/domain.models';

const LATENCY = 320;

/** No /experiments or /jobs route exists on the real API yet - stays mocked until they do. */
@Injectable({ providedIn: 'root' })
export class ExperimentService {
  private readonly http = inject(HttpClient);
  private readonly url = `${environment.apiBaseUrl}/experiments`;
  private experiments = [...EXPERIMENTS];

  list(projectId?: string): Observable<Experiment[]> {
    if (!environment.mock.experiments) {
      return this.http.get<Experiment[]>(this.url, {
        params: projectId ? { projectId } : {},
      });
    }
    const rows = projectId
      ? this.experiments.filter((e) => e.projectId === projectId)
      : this.experiments;
    return of(rows).pipe(delay(LATENCY));
  }

  get(id: string): Observable<Experiment | undefined> {
    if (!environment.mock.experiments) {
      return this.http.get<Experiment>(`${this.url}/${id}`);
    }
    return of(this.experiments.find((e) => e.id === id)).pipe(delay(LATENCY));
  }

  saveConfig(id: string, config: ModelConfig): Observable<Experiment> {
    if (!environment.mock.experiments) {
      return this.http.put<Experiment>(`${this.url}/${id}/config`, config);
    }
    const experiment = this.experiments.find((e) => e.id === id);
    if (!experiment) {
      throw new Error(`Experiment ${id} not found`);
    }
    experiment.config = config;
    experiment.status = 'configured';
    return of(experiment).pipe(delay(LATENCY));
  }

  /** Enqueues the run. The API never fits a model in the request path. */
  run(id: string): Observable<Experiment> {
    if (!environment.mock.experiments) {
      return this.http.post<Experiment>(`${this.url}/${id}/run`, {});
    }
    const experiment = this.experiments.find((e) => e.id === id);
    if (!experiment) {
      throw new Error(`Experiment ${id} not found`);
    }
    experiment.status = 'queued';
    experiment.progress = 0;
    experiment.errorMessage = null;
    return of(experiment).pipe(delay(LATENCY));
  }

  logs(id: string): Observable<string[]> {
    if (!environment.mock.experiments) {
      return this.http.get<string[]>(`${this.url}/${id}/logs`);
    }
    return of(EXPERIMENT_LOGS[id] ?? []).pipe(delay(LATENCY));
  }

  results(id: string): Observable<ExperimentResult | undefined> {
    if (!environment.mock.experiments) {
      return this.http.get<ExperimentResult>(`${this.url}/${id}/results`);
    }
    return of(RESULTS[id]).pipe(delay(LATENCY));
  }

  scenarios(experimentId?: string): Observable<Scenario[]> {
    if (!environment.mock.experiments) {
      return this.http.get<Scenario[]>(`${environment.apiBaseUrl}/scenarios`, {
        params: experimentId ? { experimentId } : {},
      });
    }
    const rows = experimentId
      ? SCENARIOS.filter((s) => s.experimentId === experimentId)
      : SCENARIOS;
    return of(rows).pipe(delay(LATENCY));
  }
}
