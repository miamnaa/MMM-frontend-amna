import { CurrencyPipe } from '@angular/common';
import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';

import { DatasetService } from '../../core/services/dataset.service';
import { SessionService } from '../../core/services/notification.service';
import { TunnelService } from '../../core/services/tunnel.service';
import { backendErrorMessage } from '../../shared/utils/backend-error';
import { PageHeader } from '../../shared/ui/page-header/page-header';
import { WizardTopbar } from '../../shared/ui/wizard-topbar/wizard-topbar';

function toNumber(value: unknown): number {
  const n = typeof value === 'number' ? value : parseFloat(String(value ?? ''));
  return Number.isFinite(n) ? n : 0;
}

/** Below this real share of total real spend, a channel is flagged as thin on real data - the same "low real spend, low real confidence" idea Optimize's Channel Health uses, applied here to decide which channels calibration should prioritize. */
const SPEND_FLAG_THRESHOLD_PCT = 5;
/** A channel's lift-test evidence nudges the one real overall belief halfway toward what that evidence suggests, rather than replacing it outright - one channel's evidence shouldn't single-handedly override what the rest of the model already reflects. */
const BELIEF_BLEND = 0.5;
const CONFIDENCE_STEP = 10;
const CONFIDENCE_CAP = 95;
const DEFAULT_BELIEF = 50;
const DEFAULT_CONFIDENCE = 50;

type Row = Record<string, unknown>;

interface ChannelEvidenceEntry {
  incremental: number | null;
  total: number | null;
}

interface CalibrationHistoryEntry {
  channel: string;
  before: number;
  after: number;
}

/**
 * Real backend: PATCH /datasets/:id/calibration, shipped 2026-08-12.
 * Confirmed directly against the real modeling engine (2026-08-19): it only
 * ever accepts one overall {contributionBeliefPercent, confidencePercent}
 * pair per dataset, never per-channel. The per-channel evidence flow below
 * is real and does real arithmetic on real numbers, but every channel's
 * evidence is a nudge that blends into that one real overall pair - it's
 * never persisted as its own separate per-channel value, because the real
 * backend has nowhere to put one.
 */
@Component({
  selector: 'app-calibrate',
  imports: [FormsModule, CurrencyPipe, PageHeader, WizardTopbar],
  templateUrl: './calibrate.html',
  styleUrl: './calibrate.css',
})
export class Calibrate implements OnInit {
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly datasetService = inject(DatasetService);
  private readonly tunnelService = inject(TunnelService);
  private readonly session = inject(SessionService);

  /** Real 'read' role can view this screen but the real save-calibration endpoint 403s for it - disables Save. */
  readonly isReadOnly = this.session.isReadOnly;

  readonly projectId = signal('');
  readonly datasetId = signal('');
  readonly infoOpen = signal(false);

  toggleInfo(): void {
    this.infoOpen.update((open) => !open);
  }

  /** The one real value this screen ultimately saves - starts at whatever's already saved for this dataset, or a neutral default if nothing's been saved yet. */
  readonly contributionBeliefPercent = signal<number | null>(null);
  readonly confidencePercent = signal<number | null>(null);
  readonly currentBelief = computed(() => this.contributionBeliefPercent() ?? DEFAULT_BELIEF);
  readonly currentConfidence = computed(() => this.confidencePercent() ?? DEFAULT_CONFIDENCE);

  readonly saving = signal(false);
  readonly saveError = signal<string | null>(null);

  /** Defaults to on - most models do want a calibration entered. */
  readonly calibrationEnabled = signal(true);
  readonly hasSavedCalibration = signal(false);

  toggleCalibration(): void {
    this.calibrationEnabled.update((on) => !on);
  }

  // ---- Real per-channel spend share, drives which channels get flagged ----

  private readonly config = computed(() => this.tunnelService.configuration());
  private readonly mediaChannels = computed(() => this.config()?.mediaColumns ?? []);

  readonly rows = signal<Row[]>([]);
  readonly rowsLoading = signal(false);
  readonly rowsError = signal<string | null>(null);

  readonly channelSpendShare = computed<{ name: string; pct: number }[]>(() => {
    const channels = this.mediaChannels();
    const rows = this.rows();
    if (channels.length === 0 || rows.length === 0) return [];
    const totals = channels.map((name) => ({
      name,
      raw: rows.reduce((sum, r) => sum + toNumber(r[name]), 0),
    }));
    const total = totals.reduce((sum, t) => sum + t.raw, 0) || 1;
    return totals.map((t) => ({ name: t.name, pct: Math.round((t.raw / total) * 1000) / 10 }));
  });

  readonly flaggedChannels = computed(() => this.channelSpendShare().filter((c) => c.pct < SPEND_FLAG_THRESHOLD_PCT));

  // ---- Per-channel evidence workflow ----

  readonly channelEvidence = signal<Record<string, ChannelEvidenceEntry>>({});
  readonly calibratedChannels = signal<Set<string>>(new Set());
  readonly calibrationHistory = signal<CalibrationHistoryEntry[]>([]);
  private readonly explicitExpandedChannel = signal<string | null>(null);

  /** Whichever flagged channel is being worked on - explicit if the user picked one, otherwise the first flagged channel that hasn't been calibrated yet. */
  readonly expandedChannel = computed(() => {
    const flagged = this.flaggedChannels();
    if (flagged.length === 0) return null;
    const explicit = this.explicitExpandedChannel();
    if (explicit && flagged.some((c) => c.name === explicit) && !this.calibratedChannels().has(explicit)) {
      return explicit;
    }
    return flagged.find((c) => !this.calibratedChannels().has(c.name))?.name ?? null;
  });

  expandChannel(name: string): void {
    this.explicitExpandedChannel.set(name);
  }

  private evidenceFor(name: string): ChannelEvidenceEntry {
    return this.channelEvidence()[name] ?? { incremental: null, total: null };
  }

  evidenceIncremental(name: string): number | null {
    return this.evidenceFor(name).incremental;
  }

  evidenceTotal(name: string): number | null {
    return this.evidenceFor(name).total;
  }

  setEvidenceIncremental(name: string, value: number | null): void {
    this.channelEvidence.update((m) => ({ ...m, [name]: { ...this.evidenceFor(name), incremental: value } }));
  }

  setEvidenceTotal(name: string, value: number | null): void {
    this.channelEvidence.update((m) => ({ ...m, [name]: { ...this.evidenceFor(name), total: value } }));
  }

  /** Real division on real user-entered numbers - null until both fields are filled in with a usable total. */
  calculatedPct(name: string): number | null {
    const e = this.evidenceFor(name);
    if (e.incremental === null || e.total === null || e.total <= 0) return null;
    return Math.round(Math.min(100, Math.max(0, (e.incremental / e.total) * 100)));
  }

  hasEvidence(name: string): boolean {
    return this.calculatedPct(name) !== null;
  }

  /** Once both evidence fields are filled in, the workflow card collapses them into a summary and shows the calculated result - this set tracks which channels have been explicitly reopened for editing via "Edit evidence", overriding that collapse. */
  private readonly reopenedForEditing = signal<Set<string>>(new Set());

  isEditingEvidence(name: string): boolean {
    return !this.hasEvidence(name) || this.reopenedForEditing().has(name);
  }

  editEvidence(name: string): void {
    this.reopenedForEditing.update((set) => new Set(set).add(name));
  }

  /** Applies this channel's evidence: blends it into the one real overall belief, nudges confidence up, and records the before/after for the right-hand summary. */
  saveChannelCalibration(name: string): void {
    const pct = this.calculatedPct(name);
    if (pct === null) return;

    const before = this.currentBelief();
    const after = Math.round(before + (pct - before) * BELIEF_BLEND);

    this.contributionBeliefPercent.set(after);
    this.confidencePercent.set(Math.min(CONFIDENCE_CAP, this.currentConfidence() + CONFIDENCE_STEP));
    this.calibrationHistory.update((history) => [...history, { channel: name, before, after }]);
    this.calibratedChannels.update((set) => new Set(set).add(name));
    this.explicitExpandedChannel.set(null);
  }

  ngOnInit(): void {
    this.projectId.set(this.route.snapshot.paramMap.get('projectId') ?? '');
    this.datasetId.set(this.route.snapshot.paramMap.get('datasetId') ?? '');

    // Real endpoint (GET /datasets/:id, confirmed working 2026-08-13) - the
    // fix for leaving this screen and coming back to a blank form even
    // though calibration was already saved. Best-effort: a failure here
    // just leaves the fields blank, same as before this existed.
    this.datasetService.getDataset(this.datasetId()).subscribe({
      next: (detail) => {
        if (detail.calibration) {
          this.contributionBeliefPercent.set(detail.calibration.contributionBeliefPercent);
          this.confidencePercent.set(detail.calibration.confidencePercent);
          this.hasSavedCalibration.set(true);
        }
      },
      error: () => {},
    });

    // Real endpoint - drives channelSpendShare/flaggedChannels below.
    // Best-effort: a failure just leaves that section empty rather than
    // blocking the rest of the page.
    this.rowsLoading.set(true);
    this.datasetService.getRows(this.datasetId()).subscribe({
      next: ({ rows }) => {
        this.rowsLoading.set(false);
        this.rows.set(rows);
      },
      error: (err: unknown) => {
        this.rowsLoading.set(false);
        this.rowsError.set(backendErrorMessage(err, "Couldn't load this dataset's data."));
      },
    });
  }

  save(): void {
    if (this.saving()) return;

    const body = this.calibrationEnabled()
      ? { contributionBeliefPercent: this.currentBelief(), confidencePercent: this.currentConfidence() }
      : { contributionBeliefPercent: DEFAULT_BELIEF, confidencePercent: DEFAULT_CONFIDENCE };

    this.saving.set(true);
    this.saveError.set(null);

    this.datasetService.saveCalibration(this.datasetId(), body).subscribe({
      next: () => {
        this.saving.set(false);
        this.hasSavedCalibration.set(true);
        this.tunnelService.setCalibration(body);
        this.router.navigate(['/hyperparameters', this.projectId(), this.datasetId()]);
      },
      error: (err: unknown) => {
        this.saving.set(false);
        this.saveError.set(backendErrorMessage(err, 'Could not save this calibration. Try again.'));
      },
    });
  }
}
