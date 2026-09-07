import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';

import { environment } from '../../../environments/environment';
import { DatasetService } from '../../core/services/dataset.service';
import { SessionService } from '../../core/services/notification.service';
import { TunnelService } from '../../core/services/tunnel.service';
import { UploadDraftService } from '../../core/services/upload-draft.service';
import { WizardTopbar } from '../../shared/ui/wizard-topbar/wizard-topbar';
import { backendErrorMessage } from '../../shared/utils/backend-error';

const ACCEPTED = ['.csv', '.xlsx', '.parquet'];
const PREVIEW_ROW_COUNT = 8;
/** Exactly what the real backend requires (confirmed from a real training failure: "No dates in 'date' match the required format (YYYY-MM-DD, e.g. 2023-11-17)"). */
const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

interface ModelOption {
  value: string;
  label: string;
  description: string;
}

/**
 * Two real engines as of 2026-09-02 (Hammad's handover) - modelType now
 * accepts 'pymc' alongside 'meridian' on the real create-dataset endpoint.
 * Built as an array from the start specifically so this day was one new
 * entry here, not a redesign.
 */
const MODEL_OPTIONS: ModelOption[] = [
  {
    value: 'meridian',
    label: 'Meridian',
    description: 'Geo-hierarchical Bayesian MMM with reach and frequency support.',
  },
  {
    value: 'pymc',
    label: 'PyMC-Marketing',
    description: 'Bayesian MMM built on PyMC - results won\'t include the actual-vs-predicted, channel confidence, or baseline-vs-marketing breakdowns yet.',
  },
];

@Component({
  selector: 'app-upload-data',
  imports: [FormsModule, WizardTopbar],
  templateUrl: './upload-data.html',
  styleUrl: './upload-data.css',
})
export class UploadData implements OnInit {
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly datasetService = inject(DatasetService);
  private readonly tunnelService = inject(TunnelService);
  private readonly draft = inject(UploadDraftService);
  private readonly session = inject(SessionService);

  /** Real 'read' role can view this screen but the real create-dataset endpoint 403s for it - disables Continue. */
  readonly isReadOnly = this.session.isReadOnly;

  readonly modelOptions = MODEL_OPTIONS;
  readonly accepted = ACCEPTED.join(',');

  /** Real GET /samples/dataset.csv (@Public(), no auth) - the real 157-week file Anas built, not the stale bundled copy this used to point at. */
  readonly sampleDatasetUrl = `${environment.apiBaseUrl}/samples/dataset.csv`;

  /**
   * Set when you arrive here already resuming a real dataset (via "Open
   * Model"/Edit, or the tunnel sidebar's "Upload Data" step while one is
   * selected) - unlike Configure/Optimize/etc., this screen has no
   * :datasetId in its own URL and nothing to re-fetch from the backend, so
   * this is the only way it can know a real dataset already exists here.
   */
  readonly existingDataset = computed(() => this.tunnelService.dataset());
  readonly hasExistingRealFile = computed(() => this.existingDataset()?.local === false);

  // Preview for an *already-uploaded* dataset - no File object exists for
  // this (it lives on the backend, not in this browser tab), so unlike the
  // fresh-pick preview below (which reads the raw File in-browser), this
  // uses the real GET /datasets/:id/rows endpoint - actual row values, not
  // just column names.
  readonly existingColumnsOpen = signal(false);
  readonly existingColumnsLoading = signal(false);
  readonly existingColumnsError = signal<string | null>(null);
  readonly existingPreviewHeaders = signal<string[]>([]);
  readonly existingPreviewRows = signal<Record<string, unknown>[]>([]);

  readonly projectId = signal('');
  readonly uploading = signal(false);
  readonly error = signal<string | null>(null);
  readonly infoOpen = signal(false);
  readonly needHelpOpen = signal(false);
  readonly dragging = signal(false);

  /**
   * Real, immediate check of the picked file's own first column (this
   * screen's own "Need help" copy already states the first column is for
   * dates) against the exact format the backend actually requires - a real
   * training run against a real (mislabeled "clean") test file just failed
   * with "193 data error(s) found. No dates in 'date' match the required
   * format (YYYY-MM-DD, e.g. 2023-11-17)", and that only surfaced at Train,
   * after Upload/Configure/Optimize/Calibrate/Hyperparameters were all
   * already filled in. This can't replace the backend's real validation
   * (Configure hasn't even confirmed which column is really the date column
   * yet), so it's a non-blocking warning, not a hard stop - but it catches
   * the single most common real failure the moment the file is picked,
   * instead of five screens later.
   */
  readonly dateFormatWarning = signal<string | null>(null);

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

  toggleNeedHelp(): void {
    this.needHelpOpen.update((open) => !open);
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

  toggleExistingColumns(): void {
    const opening = !this.existingColumnsOpen();
    this.existingColumnsOpen.set(opening);
    if (opening && this.existingPreviewRows().length === 0 && !this.existingColumnsError()) {
      this.loadExistingRows();
    }
  }

  /** Real endpoint - the only real look this screen can get at an already-uploaded file, since it never has the raw File object for one. */
  private loadExistingRows(): void {
    const dataset = this.existingDataset();
    if (!dataset) return;

    this.existingColumnsLoading.set(true);
    this.existingColumnsError.set(null);

    this.datasetService.getRows(dataset.id).subscribe({
      next: ({ rows }) => {
        this.existingColumnsLoading.set(false);
        const preview = rows.slice(0, PREVIEW_ROW_COUNT);
        this.existingPreviewHeaders.set(preview.length > 0 ? Object.keys(preview[0]) : []);
        this.existingPreviewRows.set(preview);
      },
      error: (err: unknown) => {
        this.existingColumnsLoading.set(false);
        this.existingColumnsError.set(backendErrorMessage(err, "Couldn't load this file's data."));
      },
    });
  }

  ngOnInit(): void {
    const id = this.route.snapshot.paramMap.get('projectId') ?? '';
    this.projectId.set(id);
    this.tunnelService.selectProject(id);
    this.draft.selectProject(id);
    if (!this.modelType()) this.draft.setModelType(MODEL_OPTIONS[0].value);

    // selectProject() above only clears TunnelService's dataset if this is
    // actually a *different* project than before - so on the same project,
    // dataset() still holds whatever "Open Model"/Edit (or the tunnel
    // sidebar) already loaded. Reflect its real name/type here instead of
    // showing a blank form as if nothing had ever been uploaded.
    const existing = this.tunnelService.dataset();
    if (existing && !this.modelName()) {
      this.draft.setModelName(existing.name);
      if (existing.modelType) this.draft.setModelType(existing.modelType);
    }
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
    this.dateFormatWarning.set(null);
    this.draft.setFile(picked);
    if (extension === '.csv') this.checkDateFormat(picked);
  }

  /** Real check against the real file's own content - see dateFormatWarning's doc comment for why. CSV only, same reason the preview above is CSV-only: reading XLSX/Parquet client-side needs a real parsing library, not worth pulling in for a quick sanity check. */
  private checkDateFormat(file: File): void {
    const reader = new FileReader();
    reader.onload = () => {
      const text = String(reader.result ?? '');
      const lines = text.split(/\r?\n/).filter((line) => line.trim().length > 0);
      if (lines.length < 2) return;

      const dataLines = lines.slice(1);
      const firstColumnValues = dataLines.map((line) => line.split(',')[0]?.trim() ?? '');
      const badCount = firstColumnValues.filter((v) => v.length > 0 && !ISO_DATE_RE.test(v)).length;
      if (badCount === 0) return;

      const firstBadRow = firstColumnValues.findIndex((v) => v.length > 0 && !ISO_DATE_RE.test(v));
      const example = firstColumnValues[firstBadRow];
      this.dateFormatWarning.set(
        `${badCount} of ${firstColumnValues.length} rows in the first column don't look like YYYY-MM-DD ` +
          `(e.g. row ${firstBadRow + 2}: "${example}"). Training will fail on this later unless it's fixed - ` +
          `re-export your date column as YYYY-MM-DD before continuing.`,
      );
    };
    reader.readAsText(file);
  }

  /**
   * Real endpoint (createForProject is a real POST /projects/:projectId/datasets,
   * confirmed working since 2026-08-13). A failure here is a real failure -
   * e.g. a real 403 for the 'read' role ("Your role only allows viewing...")
   * - and is shown as the real backend message, not silently swallowed.
   *
   * This used to fall back to a local-only placeholder dataset on ANY
   * error, from before real upload was wired up (2026-08-11) - that's a
   * real bug now: it hid every real failure (including a real 403) behind
   * a stale success-looking navigation into Configure with fabricated
   * local data, never showing what the backend actually said.
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
      error: (err: unknown) => {
        this.uploading.set(false);
        this.error.set(backendErrorMessage(err, 'Could not create this model. Try again.'));
      },
    });
  }
}
