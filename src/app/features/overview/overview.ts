import { Component, computed, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { toSignal } from '@angular/core/rxjs-interop';
import { catchError, of } from 'rxjs';

import { SessionService } from '../../core/services/notification.service';
import { DatasetService } from '../../core/services/dataset.service';
import { ExperimentService } from '../../core/services/experiment.service';
import { ProjectService } from '../../core/services/project.service';
import { ExperimentResult } from '../../core/models/domain.models';
import { BarChart, BarDatum } from '../../shared/charts/bar-chart/bar-chart';
import { EmptyState } from '../../shared/ui/empty-state/empty-state';
import { PageHeader } from '../../shared/ui/page-header/page-header';
import { StatTile } from '../../shared/ui/stat-tile/stat-tile';
import { StatusBadge } from '../../shared/ui/status-badge/status-badge';
import { currency, percent, relativeTime } from '../../shared/utils/format';

@Component({
  selector: 'app-overview',
  imports: [RouterLink, PageHeader, StatTile, StatusBadge, BarChart, EmptyState],
  templateUrl: './overview.html',
  styleUrl: './overview.css',
})
export class Overview {
  private readonly projectService = inject(ProjectService);
  private readonly datasetService = inject(DatasetService);
  private readonly experimentService = inject(ExperimentService);
  private readonly session = inject(SessionService);

  /** Greet by first name — the full name reads stiff in a welcome line. */
  readonly firstName = computed(() => this.session.user().name.split(' ')[0]);

  /**
   * The only genuinely live call on this page - a real 401/network failure
   * here would otherwise crash the whole render, since toSignal rethrows an
   * upstream error the next time the signal is read.
   */
  readonly projects = toSignal(
    this.projectService.list().pipe(catchError(() => of([]))),
    { initialValue: [] },
  );
  readonly datasets = toSignal(this.datasetService.list(), { initialValue: [] });
  readonly experiments = toSignal(this.experimentService.list(), { initialValue: [] });
  /**
   * No way to know "the latest completed model" without a real Experiments
   * backend - stays empty until that exists, rather than pointing at a
   * specific id that only ever existed in the old mock dataset.
   */
  readonly topResult = signal<ExperimentResult | undefined>(undefined);

  readonly relativeTime = relativeTime;

  readonly activeRuns = computed(() =>
    this.experiments().filter((e) => e.status === 'running' || e.status === 'queued'),
  );

  readonly recentExperiments = computed(() =>
    [...this.experiments()]
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .slice(0, 5),
  );

  readonly needsAttention = computed(() => ({
    failedRuns: this.experiments().filter((e) => e.status === 'failed').length,
    invalidDatasets: this.datasets().filter((d) => d.validationStatus === 'invalid').length,
  }));

  readonly contributionBars = computed<BarDatum[]>(() => {
    const result = this.topResult();
    if (!result) return [];
    return result.contributions.map((c) => ({
      label: c.channel,
      value: c.contribution,
      display: percent(c.contribution),
    }));
  });

  readonly totalSpend = computed(() => {
    const result = this.topResult();
    return result ? currency(result.totalSpend) : '—';
  });

  readonly blendedRoi = computed(() => {
    const result = this.topResult();
    if (!result) return '—';
    const incremental = result.totalRevenue * (1 - result.baselineContribution);
    return `${(incremental / result.totalSpend).toFixed(2)}x`;
  });
}
