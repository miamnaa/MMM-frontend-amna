import { Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';

import { ProjectService } from '../../core/services/project.service';
import { Project } from '../../core/models/domain.models';
import { EmptyState } from '../../shared/ui/empty-state/empty-state';
import { PageHeader } from '../../shared/ui/page-header/page-header';
import { StatusBadge } from '../../shared/ui/status-badge/status-badge';
import { relativeTime } from '../../shared/utils/format';

@Component({
  selector: 'app-projects',
  imports: [FormsModule, RouterLink, PageHeader, EmptyState, StatusBadge],
  templateUrl: './projects.html',
  styleUrl: './projects.css',
})
export class Projects {
  private readonly projectService = inject(ProjectService);

  readonly projects = signal<Project[]>([]);
  readonly loading = signal(true);
  readonly loadError = signal<string | null>(null);
  readonly dialogOpen = signal(false);
  readonly saving = signal(false);
  readonly saveError = signal<string | null>(null);

  readonly form = signal<{ name: string; description: string }>({ name: '', description: '' });

  readonly deleteTarget = signal<Project | null>(null);
  readonly deleting = signal(false);
  readonly deleteError = signal<string | null>(null);

  readonly relativeTime = relativeTime;

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
        this.projects.update((list) => [project, ...list]);
        this.saving.set(false);
        this.dialogOpen.set(false);
      },
      error: () => {
        this.saveError.set('Could not create the project. Try again.');
        this.saving.set(false);
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
      error: () => {
        this.deleteError.set('Could not delete this project. Only the owner can delete it.');
        this.deleting.set(false);
      },
    });
  }
}
