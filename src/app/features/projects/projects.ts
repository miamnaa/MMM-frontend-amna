import { HttpErrorResponse } from '@angular/common/http';
import { Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { MsalService } from '@azure/msal-angular';

import { localSignOut } from '../../core/auth/local-sign-out';
import { DatasetService } from '../../core/services/dataset.service';
import { resumeDatasetRoute } from '../../core/services/model-status';
import { ProjectService } from '../../core/services/project.service';
import { TunnelService } from '../../core/services/tunnel.service';
import { Project } from '../../core/models/domain.models';
import { EmptyState } from '../../shared/ui/empty-state/empty-state';
import { PageHeader } from '../../shared/ui/page-header/page-header';
import { StatusBadge } from '../../shared/ui/status-badge/status-badge';
import { initials, relativeTime, shortDate } from '../../shared/utils/format';

type SortOption = 'recent' | 'az' | 'created';

/** Rotates by name so the same project always lands on the same color. */
const AVATAR_PALETTE = ['#d9f2e6', '#fde8d2', '#e6e6fb', '#fde2e2', '#fdf0c7', '#dbeafe'];

function avatarColor(name: string): string {
  let hash = 0;
  for (const char of name) hash = (hash * 31 + char.charCodeAt(0)) % AVATAR_PALETTE.length;
  return AVATAR_PALETTE[hash];
}

/**
 * The backend's error body always has a `message` - a string for most
 * failures, an array of strings for validation errors (API-REFERENCE.md,
 * "Response conventions"). Prefer that real message (e.g. "Only the
 * project owner can do this.") over a generic fallback whenever it's there.
 */
function backendErrorMessage(err: unknown, fallback: string): string {
  if (err instanceof HttpErrorResponse) {
    const message: unknown = err.error?.message;
    if (typeof message === 'string') return message;
    if (Array.isArray(message)) return message.join(' ');
  }
  return fallback;
}

@Component({
  selector: 'app-projects',
  imports: [FormsModule, PageHeader, EmptyState, StatusBadge],
  templateUrl: './projects.html',
  styleUrl: './projects.css',
})
export class Projects {
  private readonly projectService = inject(ProjectService);
  private readonly datasetService = inject(DatasetService);
  private readonly tunnelService = inject(TunnelService);
  private readonly router = inject(Router);
  private readonly msalService = inject(MsalService);

  readonly projects = signal<Project[]>([]);
  readonly loading = signal(true);
  readonly loadError = signal<string | null>(null);
  readonly justCreated = signal(false);

  dismissCreated(): void {
    this.justCreated.set(false);
  }

  readonly searchQuery = signal('');
  readonly sortBy = signal<SortOption>('recent');

  readonly initials = initials;
  readonly avatarColor = avatarColor;

  readonly filteredProjects = computed(() => {
    const query = this.searchQuery().trim().toLowerCase();
    const matches = this.projects().filter(
      (p) =>
        query.length === 0 ||
        p.name.toLowerCase().includes(query) ||
        p.description.toLowerCase().includes(query),
    );

    const sort = this.sortBy();
    return [...matches].sort((a, b) => {
      if (sort === 'az') return a.name.localeCompare(b.name);
      if (sort === 'created') return b.createdAt.localeCompare(a.createdAt);
      return b.updatedAt.localeCompare(a.updatedAt);
    });
  });

  readonly dialogOpen = signal(false);
  readonly saving = signal(false);
  readonly saveError = signal<string | null>(null);

  readonly form = signal<{ name: string; description: string }>({ name: '', description: '' });

  readonly editTarget = signal<Project | null>(null);
  readonly editForm = signal<{ name: string; description: string; status: 'active' | 'archived' }>({
    name: '',
    description: '',
    status: 'active',
  });
  readonly editSaving = signal(false);
  readonly editError = signal<string | null>(null);

  readonly deleteTarget = signal<Project | null>(null);
  readonly deleting = signal(false);
  readonly deleteError = signal<string | null>(null);

  readonly relativeTime = relativeTime;
  readonly shortDate = shortDate;

  /** Which project's eye icon is currently waiting on listForProject() - id, not boolean, so each card's own icon can show its own loading state. */
  readonly viewLoading = signal<string | null>(null);

  constructor() {
    this.reload();
  }

  reload(): void {
    this.loading.set(true);
    this.loadError.set(null);
    this.projectService.list().subscribe({
      next: (projects) => {
        this.projects.set(projects);
        this.loading.set(false);
      },
      error: () => {
        this.loadError.set('Could not load projects. Check your connection and try again.');
        this.loading.set(false);
      },
    });
  }

  setSearchQuery(value: string): void {
    this.searchQuery.set(value);
  }

  setSortBy(value: SortOption): void {
    this.sortBy.set(value);
  }

  openDialog(): void {
    this.form.set({ name: '', description: '' });
    this.saveError.set(null);
    this.dialogOpen.set(true);
  }

  closeDialog(): void {
    this.dialogOpen.set(false);
  }

  updateField(key: 'name' | 'description', value: string): void {
    this.form.update((f) => ({ ...f, [key]: value }));
  }

  submit(): void {
    if (!this.form().name.trim() || this.saving()) return;
    this.saving.set(true);
    this.saveError.set(null);
    this.projectService.create(this.form()).subscribe({
      next: (project) => {
        this.saving.set(false);
        this.dialogOpen.set(false);
        this.projects.update((list) => [project, ...list]);
        this.justCreated.set(true);
        setTimeout(() => {
          this.justCreated.set(false);
          this.router.navigate(['/upload-data', project.id]);
        }, 3000);
      },
      error: (err: unknown) => {
        this.saveError.set(backendErrorMessage(err, 'Could not create the project. Try again.'));
        this.saving.set(false);
      },
    });
  }

  /** See local-sign-out.ts - the only place this is reachable now that neither the tunnel nor Projects/Models show the left Sidebar. */
  signOut(): void {
    void localSignOut(this.msalService);
  }

  /**
   * The eye icon used to open a read-only details dialog with a separate
   * "View Models" button - now it jumps straight into whichever model this
   * project has (or Upload Data if it has none), skipping both the dialog
   * and the Models list. No timestamp field exists to pick a "most recent"
   * dataset by, so with more than one this just takes the first the backend
   * returns.
   */
  viewModel(project: Project): void {
    this.viewLoading.set(project.id);
    this.datasetService.listForProject(project.id).subscribe({
      next: (datasets) => {
        this.viewLoading.set(null);
        if (datasets.length === 0) {
          this.router.navigate(['/upload-data', project.id]);
          return;
        }
        this.router.navigate(resumeDatasetRoute(this.tunnelService, project.id, datasets[0]));
      },
      error: () => {
        this.viewLoading.set(null);
        // Don't dead-end on a failed lookup - the Models list still works standalone.
        this.router.navigate(['/models', project.id]);
      },
    });
  }

  openEdit(project: Project): void {
    this.editError.set(null);
    this.editForm.set({
      name: project.name,
      description: project.description,
      status: project.status,
    });
    this.editTarget.set(project);
  }

  closeEdit(): void {
    this.editTarget.set(null);
  }

  updateEditField(key: 'name' | 'description', value: string): void {
    this.editForm.update((f) => ({ ...f, [key]: value }));
  }

  toggleEditStatus(): void {
    this.editForm.update((f) => ({ ...f, status: f.status === 'active' ? 'archived' : 'active' }));
  }

  /**
   * The API is a genuine partial update - it leaves any field you don't
   * send untouched. Sending unchanged fields back would still be correct,
   * but diffing against the original keeps the request honest about what
   * the user actually changed, and matches API-REFERENCE.md's own example
   * (a rename that deliberately omits description).
   */
  submitEdit(): void {
    const target = this.editTarget();
    const form = this.editForm();
    if (!target || !form.name.trim() || this.editSaving()) return;

    const changes: Partial<{ name: string; description: string; status: 'active' | 'archived' }> = {};
    if (form.name !== target.name) changes.name = form.name;
    if (form.description !== target.description) changes.description = form.description;
    if (form.status !== target.status) changes.status = form.status;

    if (Object.keys(changes).length === 0) {
      this.editTarget.set(null);
      return;
    }

    this.editSaving.set(true);
    this.editError.set(null);
    this.projectService.update(target.id, changes).subscribe({
      next: (updated) => {
        this.projects.update((list) => list.map((p) => (p.id === updated.id ? updated : p)));
        this.editSaving.set(false);
        this.editTarget.set(null);
      },
      error: (err: unknown) => {
        this.editError.set(backendErrorMessage(err, 'Could not update this project. Try again.'));
        this.editSaving.set(false);
      },
    });
  }

  confirmDelete(project: Project): void {
    this.deleteError.set(null);
    this.deleteTarget.set(project);
  }

  cancelDelete(): void {
    this.deleteTarget.set(null);
  }

  deleteProject(): void {
    const target = this.deleteTarget();
    if (!target || this.deleting()) return;
    this.deleting.set(true);
    this.deleteError.set(null);
    this.projectService.remove(target.id).subscribe({
      next: () => {
        this.projects.update((list) => list.filter((p) => p.id !== target.id));
        this.deleting.set(false);
        this.deleteTarget.set(null);
      },
      error: (err: unknown) => {
        this.deleteError.set(backendErrorMessage(err, 'Could not delete this project.'));
        this.deleting.set(false);
      },
    });
  }
}
