import { Component, computed, inject, signal } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';

import { DatasetService } from '../../core/services/dataset.service';
import { ExperimentService } from '../../core/services/experiment.service';
import {
  Dataset,
  Experiment,
  ModelConfig,
  ModelingEngine,
} from '../../core/models/domain.models';
import { PageHeader } from '../../shared/ui/page-header/page-header';
import { StatusBadge } from '../../shared/ui/status-badge/status-badge';

const DEFAULT_CONFIG: ModelConfig = {
  engine: 'meridian',
  kpiColumn: '',
  dateColumn: '',
  mediaColumns: [],
  controlColumns: [],
  adstock: { maxLag: 8, decay: 0.6 },
  saturation: { type: 'hill', halfSaturation: 0.5 },
  seasonality: true,
  trainTestSplit: 0.8,
  chains: 4,
  draws: 1000,
  tuneSteps: 500,
};

/** Model Studio — configure, validate, then hand the run to the queue. */
@Component({
  selector: 'app-models',
  imports: [PageHeader, StatusBadge],
  templateUrl: './models.html',
  styleUrl: './models.css',
})
export class Models {
  private readonly experimentService = inject(ExperimentService);
  private readonly datasetService = inject(DatasetService);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);

  readonly experiments = signal<Experiment[]>([]);
  readonly datasets = signal<Dataset[]>([]);
  readonly selectedId = signal<string | null>(null);
  readonly config = signal<ModelConfig>({ ...DEFAULT_CONFIG });
  readonly saved = signal(false);
  readonly queued = signal(false);

  readonly experiment = computed(
    () => this.experiments().find((e) => e.id === this.selectedId()) ?? null,
  );

  readonly dataset = computed(() => {
    const experiment = this.experiment();
    if (!experiment?.datasetId) return null;
    return this.datasets().find((d) => d.id === experiment.datasetId) ?? null;
  });

  readonly numericColumns = computed(() =>
    (this.dataset()?.columns ?? []).filter((c) => c.type === 'numeric').map((c) => c.name),
  );

  readonly dateColumns = computed(() =>
    (this.dataset()?.columns ?? []).filter((c) => c.type === 'date').map((c) => c.name),
  );

  /** The config is only runnable once every check below passes. */
  readonly checks = computed(() => {
    const c = this.config();
    const dataset = this.dataset();
    return [
      {
        label: 'A dataset is attached',
        ok: !!dataset,
        detail: dataset ? dataset.name : 'Attach a dataset in the Datasets page first.',
      },
      {
        label: 'Dataset passed schema validation',
        ok: dataset?.validationStatus === 'valid',
        detail:
          dataset?.validationStatus === 'valid'
            ? 'Schema is valid'
            : 'The worker refuses datasets that failed validation.',
      },
      { label: 'KPI column selected', ok: !!c.kpiColumn, detail: c.kpiColumn || 'Not selected' },
      { label: 'Date column selected', ok: !!c.dateColumn, detail: c.dateColumn || 'Not selected' },
      {
        label: 'At least one media channel',
        ok: c.mediaColumns.length > 0,
        detail: `${c.mediaColumns.length} selected`,
      },
      {
        label: 'Adstock lag within range',
        ok: c.adstock.maxLag >= 1 && c.adstock.maxLag <= 26,
        detail: `${c.adstock.maxLag} weeks (1–26)`,
      },
    ];
  });

  readonly isValid = computed(() => this.checks().every((c) => c.ok));

  readonly estimatedRuntime = computed(() => {
    const c = this.config();
    const minutes = Math.max(4, Math.round((c.chains * c.draws * (c.mediaColumns.length + 1)) / 900));
    return `~${minutes} min`;
  });

  constructor() {
    this.experimentService.list().subscribe((rows) => {
      this.experiments.set(rows);
      const routeId = this.route.snapshot.paramMap.get('experimentId');
      const initial = rows.find((e) => e.id === routeId) ?? rows.find((e) => e.config) ?? rows[0];
      if (initial) this.selectExperiment(initial.id);
    });
    this.datasetService.list().subscribe((rows) => this.datasets.set(rows));
  }

  selectExperiment(id: string): void {
    this.selectedId.set(id);
    this.saved.set(false);
    this.queued.set(false);
    const experiment = this.experiments().find((e) => e.id === id);
    this.config.set(experiment?.config ? { ...experiment.config } : { ...DEFAULT_CONFIG });
  }

  patch<K extends keyof ModelConfig>(key: K, value: ModelConfig[K]): void {
    this.config.update((c) => ({ ...c, [key]: value }));
    this.saved.set(false);
  }

  setEngine(value: string): void {
    this.patch('engine', value as ModelingEngine);
  }

  setNumber(key: 'chains' | 'draws' | 'tuneSteps', value: string): void {
    const parsed = Number(value);
    if (!Number.isNaN(parsed)) this.patch(key, parsed);
  }

  setAdstock(key: 'maxLag' | 'decay', value: string): void {
    const parsed = Number(value);
    if (Number.isNaN(parsed)) return;
    this.config.update((c) => ({ ...c, adstock: { ...c.adstock, [key]: parsed } }));
    this.saved.set(false);
  }

  setSaturationType(value: string): void {
    this.config.update((c) => ({
      ...c,
      saturation: { ...c.saturation, type: value as ModelConfig['saturation']['type'] },
    }));
    this.saved.set(false);
  }

  setSplit(value: string): void {
    this.patch('trainTestSplit', Number(value));
  }

  toggleColumn(kind: 'mediaColumns' | 'controlColumns', column: string): void {
    this.config.update((c) => {
      const current = c[kind];
      const next = current.includes(column)
        ? current.filter((x) => x !== column)
        : [...current, column];
      return { ...c, [kind]: next };
    });
    this.saved.set(false);
  }

  isSelected(kind: 'mediaColumns' | 'controlColumns', column: string): boolean {
    return this.config()[kind].includes(column);
  }

  save(): void {
    const id = this.selectedId();
    if (!id || !this.isValid()) return;
    this.experimentService.saveConfig(id, this.config()).subscribe((updated) => {
      this.experiments.update((list) => list.map((e) => (e.id === updated.id ? { ...updated } : e)));
      this.saved.set(true);
    });
  }

  runNow(): void {
    const id = this.selectedId();
    if (!id || !this.isValid()) return;
    this.experimentService.saveConfig(id, this.config()).subscribe(() => {
      this.experimentService.run(id).subscribe((updated) => {
        this.experiments.update((list) => list.map((e) => (e.id === updated.id ? { ...updated } : e)));
        this.queued.set(true);
      });
    });
  }

  goToExperiments(): void {
    this.router.navigate(['/experiments']);
  }
}
