import { Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';

import { ProjectService } from '../../core/services/project.service';
import { ModelingEngine, Project } from '../../core/models/domain.models';
import { EmptyState } from '../../shared/ui/empty-state/empty-state';
import { PageHeader } from '../../shared/ui/page-header/page-header';
import { engineLabel, relativeTime } from '../../shared/utils/format';

@Component({
  selector: 'app-projects',
  imports: [FormsModule, RouterLink, PageHeader, EmptyState],
  templateUrl: './projects.html',
  styleUrl: './projects.css',
})
export class Projects {
  private readonly projectService = inject(ProjectService);

  readonly projects = signal<Project[]>([]);
  readonly loading = signal(true);
  readonly dialogOpen = signal(false);
  readonly saving = signal(false);

  readonly form = signal<{ name: string; description: string; engine: ModelingEngine }>({
    name: '',
    description: '',
    engine: 'meridian',
  });

  readonly engineLabel = engineLabel;
  readonly relativeTime = relativeTime;

  constructor() {
    this.projectService.list().subscribe((projects) => {
      this.projects.set(projects);
      this.loading.set(false);
    });
  }

  openDialog(): void {
    this.form.set({ name: '', description: '', engine: 'meridian' });
    this.dialogOpen.set(true);
  }

  closeDialog(): void {
    this.dialogOpen.set(false);
  }

  updateField(key: 'name' | 'description', value: string): void {
    this.form.update((f) => ({ ...f, [key]: value }));
  }

  updateEngine(value: string): void {
    this.form.update((f) => ({ ...f, engine: value as ModelingEngine }));
  }

  submit(): void {
    if (!this.form().name.trim() || this.saving()) return;
    this.saving.set(true);
    this.projectService.create(this.form()).subscribe((project) => {
      this.projects.update((list) => [project, ...list]);
      this.saving.set(false);
      this.dialogOpen.set(false);
    });
  }
}
