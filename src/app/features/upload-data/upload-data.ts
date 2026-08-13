import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';

import { DatasetService } from '../../core/services/dataset.service';
import { TunnelService } from '../../core/services/tunnel.service';
import { UploadDraftService } from '../../core/services/upload-draft.service';
import { PageHeader } from '../../shared/ui/page-header/page-header';
import { TunnelSteps } from '../../shared/ui/tunnel-steps/tunnel-steps';

const ACCEPTED = ['.csv', '.xlsx', '.parquet'];
const PREVIEW_ROW_COUNT = 8;

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
  private readonly draft = inject(UploadDraftService);

  readonly modelOptions = MODEL_OPTIONS;
  readonly accepted = ACCEPTED.join(',');

  readonly projectId = signal('');
  readonly uploading = signal(false);
  readonly error = signal<string | null>(null);
  readonly infoOpen = signal(false);
  readonly dragging = signal(false);

  // Everything below is the draft itself - kept in UploadDraftService (not
  // local component state) so it survives navigating away and back. See
  // upload-draft.service.ts for what that does and doesn't cover on a
  // real page reload.
  readonly modelName = this.draft.modelName;
  readonly modelType = this.draft.modelType;
  readonly file = this.draft.file;
  readonly previewOpen = this.draft.previewOpen;
  readonly previewHeaders = this.draft.previewHeaders;
  readonly previewRows = this.draft.previewRows;
  readonly previewError = this.draft.previewError;
  readonly previewLoading = signal(false);

  /** Client-side preview only parses CSV - XLSX/Parquet need a real library, not worth pulling in for a quick look. */
  readonly isCsv = computed(() => (this.file()?.name ?? '').toLowerCase().endsWith('.csv'));

  toggleInfo(): void {
    this.infoOpen.update((open) => !open);
  }

  setModelName(value: string): void {
    this.draft.setModelName(value);
  }

  togglePreview(): void {
    const opening = !this.previewOpen();
    this.draft.setPreviewOpen(opening);
    if (opening && this.previewHeaders().length === 0 && !this.previewError()) {
      this.loadPreview();
    }
  }

  /**
   * Reads the picked file directly in the browser - no upload/backend call
   * needed just to look at it. Deliberately simple (splits on comma, no
   * quoted-field handling) since this is a quick sanity check before
   * Configure, not a real parse - the backend's own GET /datasets/:id/columns
   * does the real column detection once the file is actually uploaded.
   */
  private loadPreview(): void {
    const file = this.file();
    if (!file || !this.isCsv()) return;

    this.previewLoading.set(true);
    this.draft.setPreviewError(null);

    const reader = new FileReader();
    reader.onload = () => {
      this.previewLoading.set(false);
      const text = String(reader.result ?? '');
      const lines = text.split(/\r?\n/).filter((line) => line.trim().length > 0);
      if (lines.length === 0) {
        this.draft.setPreviewError('This file looks empty.');
        return;
      }
      const headers = lines[0].split(',').map((h) => h.trim());
      const rows = lines.slice(1, 1 + PREVIEW_ROW_COUNT).map((line) => line.split(',').map((c) => c.trim()));
      this.draft.setPreviewResult(headers, rows);
    };
    reader.onerror = () => {
      this.previewLoading.set(false);
      this.draft.setPreviewError('Could not read this file for preview.');
    };
    reader.readAsText(file);
  }

  ngOnInit(): void {
    const id = this.route.snapshot.paramMap.get('projectId') ?? '';
    this.projectId.set(id);
    this.tunnelService.selectProject(id);
    this.draft.selectProject(id);
    if (!this.modelType()) this.draft.setModelType(MODEL_OPTIONS[0].value);
  }

  selectModel(value: string): void {
    this.draft.setModelType(value);
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
    this.draft.setFile(picked);
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
        this.draft.clearAll();
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
        this.draft.clearAll();
        this.router.navigate(['/configure', projectId, localId]);
      },
    });
  }
}
