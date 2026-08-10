import { Component, computed, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';

import { ExperimentService } from '../../core/services/experiment.service';
import { Experiment, ExperimentStatus } from '../../core/models/domain.models';
import { EmptyState } from '../../shared/ui/empty-state/empty-state';
import { PageHeader } from '../../shared/ui/page-header/page-header';
import { StatusBadge } from '../../shared/ui/status-badge/status-badge';
import { duration, engineLabel, relativeTime } from '../../shared/utils/format';

type StatusFilter = 'all' | ExperimentStatus;

const FILTERS: { value: StatusFilter; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'running', label: 'Running' },
  { value: 'queued', label: 'Queued' },
  { value: 'completed', label: 'Completed' },
  { value: 'failed', label: 'Failed' },
  { value: 'draft', label: 'Draft' },
];

@Component({
  selector: 'app-experiments',
  imports: [RouterLink, PageHeader, StatusBadge, EmptyState],
  templateUrl: './experiments.html',
  styleUrl: './experiments.css',
})
export class Experiments {
  private readonly experimentService = inject(ExperimentService);

  readonly experiments = signal<Experiment[]>([]);
  readonly loading = signal(true);
  readonly filter = signal<StatusFilter>('all');
  readonly query = signal('');
  readonly expandedId = signal<string | null>(null);
  readonly logs = signal<string[]>([]);
  readonly runError = signal<string | null>(null);

  readonly filters = FILTERS;
  readonly duration = duration;
  readonly engineLabel = engineLabel;
  readonly relativeTime = relativeTime;

  readonly visible = computed(() => {
    const status = this.filter();
    const q = this.query().trim().toLowerCase();
    return this.experiments().filter((e) => {
      const statusOk = status === 'all' || e.status === status;
      const queryOk = !q || e.name.toLowerCase().includes(q) || e.projectName.toLowerCase().includes(q);
      return statusOk && queryOk;
    });
  });

  readonly counts = computed(() => {
    const map = new Map<StatusFilter, number>([['all', this.experiments().length]]);
    for (const e of this.experiments()) {
      map.set(e.status, (map.get(e.status) ?? 0) + 1);
    }
    return map;
  });

  constructor() {
    this.experimentService.list().subscribe((rows) => {
      this.experiments.set(rows);
      this.loading.set(false);
    });
  }

  setFilter(value: StatusFilter): void {
    this.filter.set(value);
  }

  setQuery(value: string): void {
    this.query.set(value);
  }

  countFor(value: StatusFilter): number {
    return this.counts().get(value) ?? 0;
  }

  toggleDetail(experiment: Experiment): void {
    if (this.expandedId() === experiment.id) {
      this.expandedId.set(null);
      return;
    }
    this.expandedId.set(experiment.id);
    this.logs.set([]);
    this.experimentService.logs(experiment.id).subscribe((lines) => this.logs.set(lines));
  }

  run(experiment: Experiment, event: Event): void {
    event.stopPropagation();
    this.runError.set(null);
    this.experimentService.run(experiment.id).subscribe({
      next: (updated) => {
        this.experiments.update((list) => list.map((e) => (e.id === updated.id ? { ...updated } : e)));
      },
      error: (err: unknown) => {
        this.runError.set(err instanceof Error ? err.message : 'Could not start this run.');
      },
    });
  }

  canRun(experiment: Experiment): boolean {
    return experiment.status === 'configured' || experiment.status === 'failed' || experiment.status === 'completed';
  }
}
