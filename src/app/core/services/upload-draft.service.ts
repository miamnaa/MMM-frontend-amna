import { Injectable, signal } from '@angular/core';

const PROJECT_KEY = 'upload-draft-projectId';
const NAME_KEY = 'upload-draft-name';
const TYPE_KEY = 'upload-draft-type';

/**
 * Upload Data's in-progress state (model name, model type, the picked file,
 * its parsed preview) used to live as plain component signals - meaning it
 * reset every time the component was recreated, which happens on every
 * navigation away and back, not just a hard reload. Moving it here (a
 * singleton, `providedIn: 'root'`) fixes the "navigate away and come back"
 * case completely, since the service instance survives that.
 *
 * A real page reload is a harder limit: model name/type are plain strings,
 * so they're also mirrored into sessionStorage and restored in the
 * constructor below. The picked File object (and therefore its preview)
 * cannot be restored the same way - no browser lets JS reacquire a file
 * handle without a fresh user gesture (drag/drop or a file-picker click),
 * for real security reasons, not an Angular limitation. That part is lost
 * on reload; everything that can survive, does.
 */
@Injectable({ providedIn: 'root' })
export class UploadDraftService {
  readonly projectId = signal<string | null>(null);
  readonly modelName = signal('');
  readonly modelType = signal('');
  readonly file = signal<File | null>(null);

  readonly previewOpen = signal(false);
  readonly previewHeaders = signal<string[]>([]);
  readonly previewRows = signal<string[][]>([]);
  readonly previewError = signal<string | null>(null);

  constructor() {
    const savedProject = sessionStorage.getItem(PROJECT_KEY);
    if (savedProject) {
      this.projectId.set(savedProject);
      this.modelName.set(sessionStorage.getItem(NAME_KEY) ?? '');
      this.modelType.set(sessionStorage.getItem(TYPE_KEY) ?? '');
    }
  }

  /** A different project's Upload Data shouldn't inherit a draft meant for another one. */
  selectProject(id: string): void {
    if (this.projectId() !== id) {
      this.modelName.set('');
      this.modelType.set('');
      this.clearFile();
    }
    this.projectId.set(id);
    sessionStorage.setItem(PROJECT_KEY, id);
  }

  setModelName(name: string): void {
    this.modelName.set(name);
    sessionStorage.setItem(NAME_KEY, name);
  }

  setModelType(type: string): void {
    this.modelType.set(type);
    sessionStorage.setItem(TYPE_KEY, type);
  }

  setFile(file: File): void {
    this.file.set(file);
    this.clearPreview();
  }

  clearFile(): void {
    this.file.set(null);
    this.clearPreview();
  }

  setPreviewOpen(open: boolean): void {
    this.previewOpen.set(open);
  }

  setPreviewResult(headers: string[], rows: string[][]): void {
    this.previewHeaders.set(headers);
    this.previewRows.set(rows);
  }

  setPreviewError(message: string | null): void {
    this.previewError.set(message);
  }

  private clearPreview(): void {
    this.previewOpen.set(false);
    this.previewError.set(null);
    this.previewHeaders.set([]);
    this.previewRows.set([]);
  }

  /** Called once Continue actually succeeds (real or local-fallback) - the draft has become a real dataset now, nothing left to remember here. */
  clearAll(): void {
    this.modelName.set('');
    this.modelType.set('');
    this.clearFile();
    sessionStorage.removeItem(PROJECT_KEY);
    sessionStorage.removeItem(NAME_KEY);
    sessionStorage.removeItem(TYPE_KEY);
  }
}
