import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';

import { DatasetService } from '../../core/services/dataset.service';
import { TunnelDataset, TunnelService } from '../../core/services/tunnel.service';
import { backendErrorMessage } from '../../shared/utils/backend-error';
import { PageHeader } from '../../shared/ui/page-header/page-header';
import { TunnelSteps } from '../../shared/ui/tunnel-steps/tunnel-steps';

function nonEmpty(values: string[]): string[] {
  return values.map((v) => v.trim()).filter((v) => v.length > 0);
}

/**
 * Real backend now (PATCH /datasets/:id/configuration, shipped 2026-08-12).
 * There's still no real parsed-file column list, since Upload Data's own
 * upload endpoint isn't fully live yet, so these stay honest free-text
 * inputs for column names rather than a picker pretending to know real
 * columns.
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

  readonly dateColumn = signal('');
  readonly kpiColumn = signal('');
  readonly isRevenue = signal(true);
  readonly mediaColumns = signal<string[]>(['']);
  readonly controlColumns = signal<string[]>(['']);
  readonly organicColumns = signal<string[]>(['']);

  readonly saving = signal(false);
  readonly saveError = signal<string | null>(null);

  readonly canSave = computed(
    () =>
      this.dateColumn().trim().length > 0 &&
      this.kpiColumn().trim().length > 0 &&
      nonEmpty(this.mediaColumns()).length > 0, // backend requires at least one media column
  );

  ngOnInit(): void {
    this.projectId.set(this.route.snapshot.paramMap.get('projectId') ?? '');
    this.datasetId.set(this.route.snapshot.paramMap.get('datasetId') ?? '');
  }

  setRevenue(isRevenue: boolean): void {
    this.isRevenue.set(isRevenue);
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
