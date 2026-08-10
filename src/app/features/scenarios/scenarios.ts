import { Component, computed, signal } from '@angular/core';
import { RouterLink } from '@angular/router';

import { BarChart, BarDatum } from '../../shared/charts/bar-chart/bar-chart';
import { EmptyState } from '../../shared/ui/empty-state/empty-state';
import { PageHeader } from '../../shared/ui/page-header/page-header';
import { StatTile } from '../../shared/ui/stat-tile/stat-tile';
import { currency, percent } from '../../shared/utils/format';

interface PlannerRow {
  channel: string;
  currentSpend: number;
  proposedSpend: number;
  saturationPoint: number;
  ceiling: number;
}

/**
 * What-if planner. Predicted revenue uses the same hill response the model fits,
 * so moving a slider reads consistently with the response curves on the results page.
 */
@Component({
  selector: 'app-scenarios',
  imports: [RouterLink, PageHeader, StatTile, BarChart, EmptyState],
  templateUrl: './scenarios.html',
  styleUrl: './scenarios.css',
})
export class Scenarios {
  /**
   * No way to plan against a fitted model without a real Experiments
   * backend (API-REFERENCE.md) - rows stay empty until one exists, rather
   * than fetching a specific experiment id that only existed in the old
   * mock dataset.
   */
  readonly rows = signal<PlannerRow[]>([]);
  readonly loading = signal(false);

  readonly currency = currency;
  readonly percent = percent;

  readonly baselineRevenue = computed(() =>
    this.rows().reduce((sum, r) => sum + this.predict(r, r.currentSpend), 0),
  );

  readonly proposedRevenue = computed(() =>
    this.rows().reduce((sum, r) => sum + this.predict(r, r.proposedSpend), 0),
  );

  readonly currentBudget = computed(() => this.rows().reduce((s, r) => s + r.currentSpend, 0));
  readonly proposedBudget = computed(() => this.rows().reduce((s, r) => s + r.proposedSpend, 0));

  readonly lift = computed(() => {
    const base = this.baselineRevenue();
    return base ? (this.proposedRevenue() - base) / base : 0;
  });

  readonly budgetDelta = computed(() => this.proposedBudget() - this.currentBudget());

  readonly allocationBars = computed<BarDatum[]>(() =>
    this.rows().map((r) => ({
      label: r.channel,
      value: r.proposedSpend,
      display: currency(r.proposedSpend),
    })),
  );

  /**
   * When a real Experiments backend exists, wire this back up to
   * ExperimentService.results(id) for whichever run the user is planning
   * against, and rebuild this same PlannerRow[] mapping from
   * responseCurves/contributions.
   */

  setSpend(channel: string, value: string): void {
    const parsed = Number(value);
    if (Number.isNaN(parsed)) return;
    this.rows.update((list) =>
      list.map((r) => (r.channel === channel ? { ...r, proposedSpend: parsed } : r)),
    );
  }

  reset(): void {
    this.rows.update((list) => list.map((r) => ({ ...r, proposedSpend: r.currentSpend })));
  }

  /** Even out spend so every channel sits at the same distance from saturation. */
  optimize(): void {
    const budget = this.currentBudget();
    const totalSaturation = this.rows().reduce((s, r) => s + r.saturationPoint, 0);
    this.rows.update((list) =>
      list.map((r) => ({
        ...r,
        proposedSpend: Math.round((r.saturationPoint / totalSaturation) * budget),
      })),
    );
  }

  maxSpend(row: PlannerRow): number {
    return Math.round(row.currentSpend * 2.2);
  }

  channelDelta(row: PlannerRow): number {
    return row.currentSpend ? (row.proposedSpend - row.currentSpend) / row.currentSpend : 0;
  }

  channelRevenue(row: PlannerRow): number {
    return this.predict(row, row.proposedSpend);
  }

  private predict(row: PlannerRow, spend: number): number {
    return (row.ceiling * spend) / (row.saturationPoint + spend);
  }
}
