import { Component, OnInit, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';

import { DatasetService } from '../../core/services/dataset.service';
import { TunnelService } from '../../core/services/tunnel.service';
import { PageHeader } from '../../shared/ui/page-header/page-header';
import { TunnelSteps } from '../../shared/ui/tunnel-steps/tunnel-steps';

const ACCEPTED = ['.csv', '.xlsx', '.parquet'];

interface ModelOption {
  value: string;
  label: string;
  description: string;
}

/**
 * One real option today (Meridian) - built as an array, not a hardcoded
 * label, so a second model later is one new entry here, not a redesign.
 */
const MODEL_OPTIONS: ModelOption[] = [
  {
    value: 'meridian',
    label: 'Meridian',
    description: 'Geo-hierarchical Bayesian MMM with reach and frequency support.',
  },
];

@Component({
  selector: 'app-upload-data',
  imports: [FormsModule, PageHeader, TunnelSteps],
  templateUrl: './upload-data.html',
  styleUrl: './upload-data.css',
})
export class UploadData implements OnInit {
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly datasetService = inject(DatasetService);
  private readonly tunnelService = inject(TunnelService);

  readonly modelOptions = MODEL_OPTIONS;
  readonly accepted = ACCEPTED.join(',');

  readonly projectId = signal('');
  readonly modelName = signal('');
  readonly modelType = signal(MODEL_OPTIONS[0].value);
  readonly file = signal<File | null>(null);
  readonly dragging = signal(false);
  readonly uploading = signal(false);
  readonly error = signal<string | null>(null);
  readonly infoOpen = signal(false);

  toggleInfo(): void {
    this.infoOpen.update((open) => !open);
  }

  ngOnInit(): void {
    const id = this.route.snapshot.paramMap.get('projectId') ?? '';
    this.projectId.set(id);
    this.tunnelService.selectProject(id);
  }

  selectModel(value: string): void {
    this.modelType.set(value);
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
    const dropped = event.dataTransfer?.files?.[0];
    if (dropped) this.handleFile(dropped);
  }

  onPick(event: Event): void {
    const input = event.target as HTMLInputElement;
    const picked = input.files?.[0];
    if (picked) this.handleFile(picked);
    input.value = '';
  }

  private handleFile(picked: File): void {
    const extension = picked.name.slice(picked.name.lastIndexOf('.')).toLowerCase();
    if (!ACCEPTED.includes(extension)) {
      this.error.set(`${extension || 'That file type'} is not supported. Use CSV, XLSX or Parquet.`);
      return;
    }
    this.error.set(null);
    this.file.set(picked);
  }

  /**
   * Tries the real endpoint first. It's expected to fail right now (the
   * migration hasn't run and file storage isn't configured on Anas's
   * backend, 2026-08-11) - on failure this still moves on with a local
   * placeholder dataset (flagged `local: true`) so Configure stays reachable
   * and testable before the backend is actually live, rather than
   * dead-ending the whole tunnel. Configure shows the honest "using local
   * data" notice itself, since we navigate away immediately either way and
   * a notice here would just flash and vanish.
   */
  continue(): void {
    const file = this.file();
    const projectId = this.projectId();
    const name = this.modelName().trim();
    if (!file || !name || this.uploading()) return;

    this.uploading.set(true);
    this.error.set(null);

    this.datasetService.createForProject(projectId, file, name, this.modelType()).subscribe({
      next: (dataset) => {
        this.uploading.set(false);
        this.tunnelService.setDataset({
          id: dataset.id,
          name: dataset.name,
          modelType: this.modelType(),
          local: false,
        });
        this.router.navigate(['/configure', projectId, dataset.id]);
      },
      error: () => {
        this.uploading.set(false);
        const localId = `local-${crypto.randomUUID()}`;
        this.tunnelService.setDataset({
          id: localId,
          name,
          modelType: this.modelType(),
          local: true,
        });
        this.router.navigate(['/configure', projectId, localId]);
      },
    });
  }
}
