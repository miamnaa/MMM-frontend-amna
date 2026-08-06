import { Component, computed, input } from '@angular/core';

type BadgeTone = 'neutral' | 'success' | 'running' | 'queued' | 'danger' | 'warning';

const TONES: Record<string, BadgeTone> = {
  draft: 'neutral',
  configured: 'neutral',
  queued: 'queued',
  running: 'running',
  completed: 'success',
  failed: 'danger',
  valid: 'success',
  invalid: 'danger',
  pending: 'warning',
};

const LABELS: Record<string, string> = {
  draft: 'Draft',
  configured: 'Configured',
  queued: 'Queued',
  running: 'Running',
  completed: 'Completed',
  failed: 'Failed',
  valid: 'Valid',
  invalid: 'Invalid',
  pending: 'Validating',
};

/** Status is never carried by color alone — the badge always shows a dot plus a label. */
@Component({
  selector: 'app-status-badge',
  template: `
    <span class="badge" [class]="'tone-' + tone()">
      <span class="dot" [class.pulse]="status() === 'running'"></span>
      {{ label() }}
    </span>
  `,
  styles: `
    .badge {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      height: 22px;
      padding: 0 9px 0 8px;
      border-radius: var(--r-full);
      font-size: 11.5px;
      font-weight: 600;
      white-space: nowrap;
    }
    .dot {
      width: 6px;
      height: 6px;
      border-radius: 50%;
      background: currentColor;
      flex: none;
    }
    .pulse {
      animation: pulse 1.4s ease-in-out infinite;
    }
    @keyframes pulse {
      0%, 100% { opacity: 1; }
      50% { opacity: 0.3; }
    }
    .tone-neutral { background: var(--gray-100); color: var(--gray-600); }
    .tone-success { background: var(--brand-50); color: var(--brand-700); }
    .tone-running { background: var(--blue-50); color: var(--blue-600); }
    .tone-queued { background: var(--gray-100); color: var(--gray-700); }
    .tone-danger { background: var(--red-50); color: var(--red-600); }
    .tone-warning { background: var(--amber-50); color: var(--amber-700); }
  `,
})
export class StatusBadge {
  readonly status = input.required<string>();
  readonly tone = computed(() => TONES[this.status()] ?? 'neutral');
  readonly label = computed(() => LABELS[this.status()] ?? this.status());
}
