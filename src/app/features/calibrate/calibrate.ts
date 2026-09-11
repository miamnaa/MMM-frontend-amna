import { CurrencyPipe, DecimalPipe } from '@angular/common';
import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';

import { DatasetService } from '../../core/services/dataset.service';
import { SessionService } from '../../core/services/notification.service';
import { TunnelService } from '../../core/services/tunnel.service';
import { backendErrorMessage } from '../../shared/utils/backend-error';
import { getLocalPref, setLocalPref } from '../../shared/utils/local-pref';
import { PageHeader } from '../../shared/ui/page-header/page-header';
import { WizardTopbar } from '../../shared/ui/wizard-topbar/wizard-topbar';

function toNumber(value: unknown): number {
  const n = typeof value === 'number' ? value : parseFloat(String(value ?? ''));
  return Number.isFinite(n) ? n : 0;
}

/**
 * Below this real share of total real spend, a channel is flagged as thin on
 * real data - the same "low real spend, low real confidence" idea Optimize's
 * Channel Health uses, applied here to decide which channels calibration
 * should prioritize. Just the fallback before the real channel count is
 * known - defaultSpendFlagThresholdPct() below is what actually sets it.
 */
const DEFAULT_SPEND_FLAG_THRESHOLD_PCT = 5;
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
  confidenceBefore: number;
  confidenceAfter: number;
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
  imports: [FormsModule, CurrencyPipe, DecimalPipe, PageHeader, WizardTopbar],
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

  /**
   * Same real rule Optimize's Channel Health uses for its own spend cutoff:
   * no statistical convention for "too small a channel to trust," so the
   * default is grounded in this dataset's real channel count instead of a
   * flat guess - half of what an equal split of spend across all real
   * channels would give each one.
   */
  readonly maxSpendPct = computed(() => Math.max(5, ...this.channelSpendShare().map((c) => c.pct)));
  private defaultSpendFlagThresholdPct(channelCount: number): number {
    if (channelCount <= 0) return DEFAULT_SPEND_FLAG_THRESHOLD_PCT;
    return Math.round((50 / channelCount) * 10) / 10;
  }

  /** Persists to localStorage per dataset (see local-pref.ts) - same real request as Optimize's own cutoffs: a threshold someone actually set should survive closing and reopening the browser. Hydrated once datasetId is known, in ngOnInit below. */
  readonly spendFlagThresholdEnabled = signal(true);
  readonly spendFlagThresholdPct = signal(DEFAULT_SPEND_FLAG_THRESHOLD_PCT);
  readonly spendFlagThresholdTouched = signal(false);
  toggleSpendFlagThresholdEnabled(): void {
    const next = !this.spendFlagThresholdEnabled();
    this.spendFlagThresholdEnabled.set(next);
    setLocalPref(this.datasetId(), 'spendFlagThresholdEnabled', next);
  }
  setSpendFlagThresholdPct(value: number): void {
    this.spendFlagThresholdTouched.set(true);
    this.spendFlagThresholdPct.set(value);
    setLocalPref(this.datasetId(), 'spendFlagThresholdPct', value);
  }

  private hydratePersistedThreshold(): void {
    const id = this.datasetId();
    this.spendFlagThresholdEnabled.set(getLocalPref(id, 'spendFlagThresholdEnabled', true));
    const saved = getLocalPref<number | null>(id, 'spendFlagThresholdPct', null);
    if (saved !== null) {
      this.spendFlagThresholdPct.set(saved);
      this.spendFlagThresholdTouched.set(true);
    }
  }

  readonly flaggedChannels = computed(() =>
    this.spendFlagThresholdEnabled() ? this.channelSpendShare().filter((c) => c.pct < this.spendFlagThresholdPct()) : [],
  );
  readonly flaggedChannelNames = computed(() => this.flaggedChannels().map((c) => c.name).join(', '));

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

  /**
   * The real overall belief this channel's evidence would produce if
   * saved right now - the exact same blend formula saveChannelCalibration()
   * actually applies, computed here so the Review card can show the real
   * result instead of this channel's own raw evidence % (which is not the
   * same number - evidence only ever moves belief halfway toward it, never
   * replaces it outright). Shown so the number on screen matches the
   * number that actually gets saved.
   */
  previewBeliefAfter(name: string): number | null {
    const pct = this.calculatedPct(name);
    if (pct === null) return null;
    const before = this.currentBelief();
    return Math.round(before + (pct - before) * BELIEF_BLEND);
  }

  /** Same real rule saveChannelCalibration() applies: confidence steps up by a flat amount, capped - shown here so the Review card previews the real result. */
  previewConfidenceAfter(): number {
    return Math.min(CONFIDENCE_CAP, this.currentConfidence() + CONFIDENCE_STEP);
  }

  /**
   * Real bug, fixed 2026-09-08: this used to collapse the evidence inputs
   * into the read-only Calculated/Review summary automatically the moment
   * `hasEvidence()` went true - which happens the instant Total $ gets ANY
   * non-zero value, including after just the first keystroke. That
   * destroyed the input fields mid-typing, so only the first digit (e.g.
   * "1" of "102000") ever actually landed, and the summary was stuck
   * showing that stale, incomplete math forever after - it was never a
   * caching bug, the fields the user was typing into were just gone.
   * Now a channel only leaves the editing view on an explicit
   * confirmEvidence() click, never from typing alone.
   */
  private readonly confirmedEvidence = signal<Set<string>>(new Set());

  isEditingEvidence(name: string): boolean {
    return !this.confirmedEvidence().has(name);
  }

  /** Explicit "done typing, show me the math" action - only enabled once both fields are real and usable (hasEvidence). */
  confirmEvidence(name: string): void {
    if (!this.hasEvidence(name)) return;
    this.confirmedEvidence.update((set) => new Set(set).add(name));
  }

  editEvidence(name: string): void {
    this.confirmedEvidence.update((set) => {
      const next = new Set(set);
      next.delete(name);
      return next;
    });
  }

  /**
   * Real bug, fixed 2026-09-08: once a channel was saved via
   * saveChannelCalibration(), it became a static "✓ Calibrated" row with
   * no way back - if the evidence that produced it was wrong (e.g. Bug 1
   * above), there was no path to correct it; the real saved
   * calibration was permanently stuck on the bad numbers. Only the most
   * recently calibrated channel can be undone - correctly reverses just
   * that channel's blend by restoring the exact before/before-confidence
   * this history entry recorded (rather than re-blending on top of an
   * already-nudged value, which would double-count it), then reopens its
   * evidence fields with whatever was typed still intact so only the
   * wrong field needs fixing.
   */
  canEditCalibratedChannel(name: string): boolean {
    const history = this.calibrationHistory();
    return history.length > 0 && history[history.length - 1].channel === name;
  }

  undoChannelCalibration(name: string): void {
    const history = this.calibrationHistory();
    const last = history[history.length - 1];
    if (!last || last.channel !== name) return;

    this.contributionBeliefPercent.set(last.before);
    this.confidencePercent.set(last.confidenceBefore);
    this.calibrationHistory.set(history.slice(0, -1));
    this.calibratedChannels.update((set) => {
      const next = new Set(set);
      next.delete(name);
      return next;
    });
    this.editEvidence(name);
    this.explicitExpandedChannel.set(name);
  }

  /** Applies this channel's evidence: blends it into the one real overall belief, nudges confidence up, and records the real before/after of both for the right-hand summary - using the same preview methods the Review card already showed, so what gets saved is never a surprise. */
  saveChannelCalibration(name: string): void {
    const after = this.previewBeliefAfter(name);
    if (after === null) return;

    const before = this.currentBelief();
    const confidenceBefore = this.currentConfidence();
    const confidenceAfter = this.previewConfidenceAfter();

    this.contributionBeliefPercent.set(after);
    this.confidencePercent.set(confidenceAfter);
    this.calibrationHistory.update((history) => [
      ...history,
      { channel: name, before, after, confidenceBefore, confidenceAfter },
    ]);
    this.calibratedChannels.update((set) => new Set(set).add(name));
    this.explicitExpandedChannel.set(null);
  }

  ngOnInit(): void {
    this.projectId.set(this.route.snapshot.paramMap.get('projectId') ?? '');
    this.datasetId.set(this.route.snapshot.paramMap.get('datasetId') ?? '');

    this.hydratePersistedThreshold();

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
        if (!this.spendFlagThresholdTouched()) {
          this.spendFlagThresholdPct.set(this.defaultSpendFlagThresholdPct(this.mediaChannels().length));
        }
      },
      error: (err: unknown) => {
        this.rowsLoading.set(false);
        this.rowsError.set(backendErrorMessage(err, "Couldn't load this dataset's data."));
      },
    });
  }

  /**
   * Real contract confirmed 2026-09-08 (Hammad, via Anas): both fields are
   * optional, but only together - send both, or send `{}`. An empty body
   * is a real, valid "no belief input," not an error state, so the
   * disabled-toggle case must send `{}` for real instead of a fabricated
   * 50/50 placeholder that would assert a belief the user never actually
   * gave.
   */
  save(): void {
    if (this.saving()) return;

    const enabled = this.calibrationEnabled();
    const belief = this.currentBelief();
    const confidence = this.currentConfidence();
    const body = enabled ? { contributionBeliefPercent: belief, confidencePercent: confidence } : {};

    this.saving.set(true);
    this.saveError.set(null);

    this.datasetService.saveCalibration(this.datasetId(), body).subscribe({
      next: () => {
        this.saving.set(false);
        this.hasSavedCalibration.set(enabled);
        if (enabled) {
          this.tunnelService.setCalibration({ contributionBeliefPercent: belief, confidencePercent: confidence });
        } else {
          this.tunnelService.clearCalibration();
        }
        this.router.navigate(['/hyperparameters', this.projectId(), this.datasetId()]);
      },
      error: (err: unknown) => {
        this.saving.set(false);
        this.saveError.set(backendErrorMessage(err, 'Could not save this calibration. Try again.'));
      },
    });
  }
}
