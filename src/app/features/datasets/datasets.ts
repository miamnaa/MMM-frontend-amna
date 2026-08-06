import { Component, computed, inject, signal } from '@angular/core';

import { DatasetService } from '../../core/services/dataset.service';
import { ProjectService } from '../../core/services/project.service';
import { Dataset, Project } from '../../core/models/domain.models';
import { EmptyState } from '../../shared/ui/empty-state/empty-state';
import { PageHeader } from '../../shared/ui/page-header/page-header';
import { StatusBadge } from '../../shared/ui/status-badge/status-badge';
import { fileSize, relativeTime, shortDate } from '../../shared/utils/format';

const ACCEPTED = ['.csv', '.xlsx', '.parquet'];

@Component({
  selector: 'app-datasets',
  imports: [PageHeader, StatusBadge, EmptyState],
  templateUrl: './datasets.html',
  styleUrl: './datasets.css',
})
export class Datasets {
  private readonly datasetService = inject(DatasetService);
  private readonly projectService = inject(ProjectService);

  readonly datasets = signal<Dataset[]>([]);
  readonly projects = signal<Project[]>([]);
  readonly loading = signal(true);
  readonly dragging = signal(false);
  readonly uploading = signal(false);
  readonly uploadError = signal<string | null>(null);
  readonly selectedId = signal<string | null>(null);
  readonly targetProjectId = signal<string>('p-1');

  readonly accepted = ACCEPTED.join(',');
  readonly fileSize = fileSize;
  readonly relativeTime = relativeTime;
  readonly shortDate = shortDate;

  readonly selected = computed(() => this.datasets().find((d) => d.id === this.selectedId()) ?? null);

  constructor() {
    this.datasetService.list().subscribe((rows) => {
      this.datasets.set(rows);
      this.selectedId.set(rows[0]?.id ?? null);
      this.loading.set(false);
    });
    this.projectService.list().subscribe((rows) => {
      this.projects.set(rows);
      if (rows.length) this.targetProjectId.set(rows[0].id);
    });
  }

  onDragOver(event: DragEvent): void {
    event.preventDefault();
    this.dragging.set(true);
  }

  onDragLeave(): void {
    this.dragging.set(false);
  }

  onDrop(event: DragEvent): void {
    event.preventDefault();
    this.dragging.set(false);
    const file = event.dataTransfer?.files?.[0];
    if (file) this.handleFile(file);
  }

  onPick(event: Event): void {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    if (file) this.handleFile(file);
    input.value = '';
  }

  setProject(value: string): void {
    this.targetProjectId.set(value);
  }

  select(id: string): void {
    this.selectedId.set(id);
  }

  private handleFile(file: File): void {
    const extension = file.name.slice(file.name.lastIndexOf('.')).toLowerCase();
    if (!ACCEPTED.includes(extension)) {
      this.uploadError.set(`${extension || 'That file type'} is not supported. Use CSV, XLSX or Parquet.`);
      return;
    }

    this.uploadError.set(null);
    this.uploading.set(true);
    this.datasetService.upload(file, this.targetProjectId()).subscribe({
      next: (dataset) => {
        this.datasets.update((list) => [dataset, ...list]);
        this.selectedId.set(dataset.id);
        this.uploading.set(false);
      },
      error: () => {
        this.uploadError.set('Upload failed. Check your connection and try again.');
        this.uploading.set(false);
      },
    });
  }
}
