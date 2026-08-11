import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute } from '@angular/router';

import { TunnelDataset, TunnelService } from '../../core/services/tunnel.service';
import { PageHeader } from '../../shared/ui/page-header/page-header';

/**
 * No real backend for Configure yet (CMP-79) - every field here is
 * genuinely local/mock state, saved only on TunnelService, not sent
 * anywhere. There's also no real parsed-file column list yet since Upload
 * Data's own backend isn't live, so these are honest free-text inputs for
 * column names rather than a picker pretending to know real columns.
 */
@Component({
  selector: 'app-configure',
  imports: [FormsModule, PageHeader],
  templateUrl: './configure.html',
  styleUrl: './configure.css',
})
export class Configure implements OnInit {
  private readonly route = inject(ActivatedRoute);
  private readonly tunnelService = inject(TunnelService);

  readonly projectId = signal('');
  readonly dataset = computed<TunnelDataset | null>(() => this.tunnelService.dataset());

  readonly dateColumn = signal('');
  readonly kpiColumn = signal('');
  readonly isRevenue = signal(true);
  readonly revenuePerUnit = signal<number | null>(null);
  readonly mediaColumns = signal<string[]>(['']);
  readonly controlColumns = signal<string[]>(['']);
  readonly organicColumns = signal<string[]>(['']);

  readonly saved = signal(false);

  readonly canSave = computed(
    () =>
      this.dateColumn().trim().length > 0 &&
      this.kpiColumn().trim().length > 0 &&
      (this.isRevenue() || this.revenuePerUnit() !== null),
  );

  ngOnInit(): void {
    this.projectId.set(this.route.snapshot.paramMap.get('projectId') ?? '');
  }

  setRevenue(isRevenue: boolean): void {
    this.isRevenue.set(isRevenue);
    if (isRevenue) this.revenuePerUnit.set(null);
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

  /** Nowhere further to go yet - the sequence stops here per the spec, so this just confirms locally. */
  save(): void {
    if (!this.canSave()) return;
    this.saved.set(true);
  }
}
