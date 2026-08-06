import { Component, computed, inject, signal } from '@angular/core';
import { ActivatedRoute, RouterLink } from '@angular/router';

import { ExperimentService } from '../../core/services/experiment.service';
import { Experiment, ExperimentResult } from '../../core/models/domain.models';
import { BarChart, BarDatum } from '../../shared/charts/bar-chart/bar-chart';
import { LineChart, LineSeries } from '../../shared/charts/line-chart/line-chart';
import { EmptyState } from '../../shared/ui/empty-state/empty-state';
import { PageHeader } from '../../shared/ui/page-header/page-header';
import { StatTile } from '../../shared/ui/stat-tile/stat-tile';
import { compactCurrency, currency, percent, shortDate } from '../../shared/utils/format';

@Component({
  selector: 'app-results-dashboard',
  imports: [RouterLink, PageHeader, StatTile, BarChart, LineChart, EmptyState],
  templateUrl: './results-dashboard.html',
  styleUrl: './results-dashboard.css',
})
export class ResultsDashboard {
  private readonly experimentService = inject(ExperimentService);
  private readonly route = inject(ActivatedRoute);

  readonly completed = signal<Experiment[]>([]);
  readonly selectedId = signal<string | null>(null);
  readonly result = signal<ExperimentResult | undefined>(undefined);
  readonly loading = signal(true);

  readonly currency = currency;
  readonly percent = percent;
  readonly shortDate = shortDate;
  readonly formatSpend = (v: number) => compactCurrency(v);
  readonly formatResponse = (v: number) => compactCurrency(v);

  readonly experiment = computed(
    () => this.completed().find((e) => e.id === this.selectedId()) ?? null,
  );

  readonly contributionBars = computed<BarDatum[]>(() =>
    (this.result()?.contributions ?? []).map((c) => ({
      label: c.channel,
      value: c.contribution,
      display: percent(c.contribution),
    })),
  );

  readonly roiBars = computed<BarDatum[]>(() =>
    (this.result()?.contributions ?? []).map((c) => ({
      label: c.channel,
      value: c.roi,
      display: `${c.roi.toFixed(2)}x`,
    })),
  );

  readonly curves = computed<LineSeries[]>(() =>
    (this.result()?.responseCurves ?? []).map((c) => ({
      name: c.channel,
      points: c.points.map((p) => ({ x: p.spend, y: p.response })),
      marker: { x: c.currentSpend, label: 'Current spend' },
    })),
  );

  readonly incrementalRevenue = computed(() => {
    const r = this.result();
    return r ? r.totalRevenue * (1 - r.baselineContribution) : 0;
  });

  readonly blendedRoi = computed(() => {
    const r = this.result();
    if (!r) return '—';
    return `${(this.incrementalRevenue() / r.totalSpend).toFixed(2)}x`;
  });

  constructor() {
    this.experimentService.list().subscribe((rows) => {
      const done = rows.filter((e) => e.status === 'completed');
      this.completed.set(done);
      const routeId = this.route.snapshot.paramMap.get('experimentId');
      const initial = done.find((e) => e.id === routeId) ?? done[0];
      if (initial) {
        this.select(initial.id);
      } else {
        this.loading.set(false);
      }
    });
  }

  select(id: string): void {
    this.selectedId.set(id);
    this.loading.set(true);
    this.experimentService.results(id).subscribe((r) => {
      this.result.set(r);
      this.loading.set(false);
    });
  }

  /** Placeholder until the reporting endpoint lands — see CMP-8. */
  exportReport(): void {
    const r = this.result();
    if (!r) return;
    const rows = [
      ['channel', 'contribution', 'spend', 'roi', 'cpa'],
      ...r.contributions.map((c) => [
        c.channel,
        c.contribution.toFixed(4),
        String(c.spend),
        c.roi.toFixed(2),
        c.cpa.toFixed(2),
      ]),
    ];
    const csv = rows.map((row) => row.join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `${this.experiment()?.name ?? 'results'}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  }
}
