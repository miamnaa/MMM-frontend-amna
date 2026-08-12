import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';

import { DatasetService } from '../../core/services/dataset.service';
import { TunnelDataset, TunnelService } from '../../core/services/tunnel.service';
import { backendErrorMessage } from '../../shared/utils/backend-error';
import { PageHeader } from '../../shared/ui/page-header/page-header';
import { TunnelSteps } from '../../shared/ui/tunnel-steps/tunnel-steps';

type ColumnField = 'date' | 'target' | 'media' | 'control' | 'organic' | 'geo';

function nonEmpty(values: string[]): string[] {
  return values.map((v) => v.trim()).filter((v) => v.length > 0);
}

/**
 * Real backend now (PATCH /datasets/:id/configuration, shipped 2026-08-12).
 * Column names come from the real file when possible - GET
 * /datasets/:id/columns (shipped 2026-08-12, CSV only for now) - shown as
 * pickers so nobody has to remember/retype a column name from their file.
 * Falls back to free-text entry when that call isn't available (non-CSV
 * file, or any other error) rather than breaking the screen.
 */
@Component({
  selector: 'app-configure',
  imports: [FormsModule, PageHeader, TunnelSteps],
  templateUrl: './configure.html',
  styleUrl: './configure.css',
})
export class Configure implements OnInit {
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly datasetService = inject(DatasetService);
  private readonly tunnelService = inject(TunnelService);

  readonly projectId = signal('');
  readonly datasetId = signal('');
  readonly dataset = computed<TunnelDataset | null>(() => this.tunnelService.dataset());

  /**
   * A local placeholder was never a real dataset id - the real Save call
   * would just fail with a confusing "uuid is expected" error from the
   * backend's validator, so this blocks it here with an honest reason
   * instead. Also skips the columns fetch below, since that would fail the
   * same way against a fake id.
   */
  readonly isLocalDataset = computed(() => this.dataset()?.local === true);

  readonly availableColumns = signal<string[]>([]);
  readonly columnsLoading = signal(false);
  readonly columnsUnavailable = signal(false);
  readonly columnsNotice = signal<string | null>(null);

  readonly dateColumn = signal('');
  readonly kpiColumn = signal('');
  readonly isRevenue = signal(true);
  readonly revenuePerKpiValue = signal<number | null>(null);
  readonly mediaColumns = signal<string[]>([]);
  readonly controlColumns = signal<string[]>([]);
  readonly organicColumns = signal<string[]>([]);
  readonly geoColumns = signal<string[]>([]);

  readonly saving = signal(false);
  readonly saveError = signal<string | null>(null);

  readonly canSave = computed(
    () =>
      !this.isLocalDataset() &&
      this.dateColumn().trim().length > 0 &&
      this.kpiColumn().trim().length > 0 &&
      nonEmpty(this.mediaColumns()).length > 0 && // backend requires at least one media column
      (this.isRevenue() || (this.revenuePerKpiValue() ?? 0) > 0), // required whenever the KPI isn't already in dollars
  );

  ngOnInit(): void {
    this.projectId.set(this.route.snapshot.paramMap.get('projectId') ?? '');
    this.datasetId.set(this.route.snapshot.paramMap.get('datasetId') ?? '');

    if (this.isLocalDataset()) {
      // No real dataset behind this id - a columns call would just fail
      // the same confusing way the old Save call did.
      this.columnsUnavailable.set(true);
      this.seedFallbackRows();
      return;
    }

    this.columnsLoading.set(true);
    this.datasetService.getColumns(this.datasetId()).subscribe({
      next: ({ columns, suggestions }) => {
        this.columnsLoading.set(false);
        this.availableColumns.set(columns);
        // Deliberately conservative on the backend - null means "no
        // confident match," not "no date/target column exists." Still
        // fully editable before Save, nothing here is persisted yet.
        this.dateColumn.set(suggestions.dateColumn ?? '');
        this.kpiColumn.set(suggestions.targetColumn ?? '');
        this.mediaColumns.set(suggestions.mediaColumns);
        this.controlColumns.set(suggestions.controlColumns);
        this.organicColumns.set(suggestions.organicColumns);
      },
      error: (err: unknown) => {
        this.columnsLoading.set(false);
        this.columnsUnavailable.set(true);
        this.columnsNotice.set(
          backendErrorMessage(
            err,
            "Automatic column detection isn't available for this file yet — enter column names manually.",
          ),
        );
        this.seedFallbackRows();
      },
    });
  }

  /** Manual mode needs at least one empty row per list so "+ Add" has something to show alongside. */
  private seedFallbackRows(): void {
    if (this.mediaColumns().length === 0) this.mediaColumns.set(['']);
    if (this.controlColumns().length === 0) this.controlColumns.set(['']);
    if (this.organicColumns().length === 0) this.organicColumns.set(['']);
    if (this.geoColumns().length === 0) this.geoColumns.set(['']);
  }

  setRevenue(isRevenue: boolean): void {
    this.isRevenue.set(isRevenue);
    // The backend 400s if revenuePerKpiValue is sent alongside kpiType "revenue" - the KPI's
    // already in dollars, so there's nothing to hold once the toggle switches back.
    if (isRevenue) this.revenuePerKpiValue.set(null);
  }

  setRevenuePerKpiValue(value: number | null): void {
    this.revenuePerKpiValue.set(value);
  }

  /** True if `column` is already assigned to a field other than `field` - used to grey out picker options. */
  isUsedElsewhere(column: string, field: ColumnField): boolean {
    if (field !== 'date' && this.dateColumn() === column) return true;
    if (field !== 'target' && this.kpiColumn() === column) return true;
    if (field !== 'media' && this.mediaColumns().includes(column)) return true;
    if (field !== 'control' && this.controlColumns().includes(column)) return true;
    if (field !== 'organic' && this.organicColumns().includes(column)) return true;
    if (field !== 'geo' && this.geoColumns().includes(column)) return true;
    return false;
  }

  setDateColumn(value: string): void {
    this.dateColumn.set(value);
  }

  setKpiColumn(value: string): void {
    this.kpiColumn.set(value);
  }

  toggleColumn(field: 'media' | 'control' | 'organic', column: string): void {
    if (this.isUsedElsewhere(column, field)) return;
    const target = this.listSignal(field);
    target.update((items) => (items.includes(column) ? items.filter((c) => c !== column) : [...items, column]));
  }

  updateListItem(list: 'media' | 'control' | 'organic', index: number, value: string): void {
    const target = this.listSignal(list);
    target.update((items) => items.map((item, i) => (i === index ? value : item)));
  }

  addListItem(list: 'media' | 'control' | 'organic'): void {
    this.listSignal(list).update((items) => [...items, '']);
  }

  removeListItem(list: 'media' | 'control' | 'organic', index: number): void {
    const target = this.listSignal(list);
    // Always leave at least one row so the "+ Add" affordance stays visible.
    target.update((items) => (items.length > 1 ? items.filter((_, i) => i !== index) : ['']));
  }

  private listSignal(list: 'media' | 'control' | 'organic') {
    if (list === 'media') return this.mediaColumns;
    if (list === 'control') return this.controlColumns;
    return this.organicColumns;
  }

  save(): void {
    if (!this.canSave() || this.saving()) return;

    const body = {
      dateColumn: this.dateColumn().trim(),
      targetColumn: this.kpiColumn().trim(),
      kpiType: this.isRevenue() ? ('revenue' as const) : ('non_revenue' as const),
      mediaColumns: nonEmpty(this.mediaColumns()),
      controlColumns: nonEmpty(this.controlColumns()),
      organicColumns: nonEmpty(this.organicColumns()),
    };

    this.saving.set(true);
    this.saveError.set(null);

    this.datasetService.saveConfiguration(this.datasetId(), body).subscribe({
      next: () => {
        this.saving.set(false);
        this.tunnelService.setConfiguration(body);
        this.router.navigate(['/optimize', this.projectId(), this.datasetId()]);
      },
      error: (err: unknown) => {
        this.saving.set(false);
        this.saveError.set(backendErrorMessage(err, 'Could not save this configuration. Try again.'));
      },
    });
  }
}
