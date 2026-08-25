import { Component, ElementRef, HostListener, inject, input, signal } from '@angular/core';

/**
 * A small "what does this mean?" toggle for a technical term (ROI, carryover,
 * saturation, R squared, ...) - click the badge, get one plain-English
 * sentence explaining it, click anywhere else to dismiss. Exists so a
 * non-technical reader isn't stuck guessing what a section title means
 * without breaking up the page with permanent explanatory text everyone
 * else has to scroll past.
 */
@Component({
  selector: 'app-info-tip',
  template: `
    <span class="info-tip">
      <button
        type="button"
        class="info-tip-badge"
        [attr.aria-expanded]="open()"
        [attr.aria-label]="'What does ' + term() + ' mean?'"
        (click)="toggle($event)"
      >
        ?
      </button>
      @if (open()) {
        <div class="info-tip-pop" role="tooltip">
          <strong>{{ term() }}</strong>
          <p>{{ text() }}</p>
        </div>
      }
    </span>
  `,
  styles: `
    .info-tip {
      position: relative;
      display: inline-flex;
      vertical-align: middle;
      margin-left: 6px;
    }
    .info-tip-badge {
      width: 17px;
      height: 17px;
      border-radius: 50%;
      border: 1px solid var(--border-strong, var(--border));
      background: var(--surface);
      color: var(--text-muted);
      font-size: 11px;
      font-weight: 700;
      line-height: 1;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      cursor: pointer;
      padding: 0;
    }
    .info-tip-badge:hover,
    .info-tip-badge[aria-expanded="true"] {
      color: var(--brand-700);
      border-color: var(--brand-500);
      background: var(--brand-50);
    }
    .info-tip-pop {
      position: absolute;
      z-index: 5;
      top: calc(100% + 8px);
      left: 0;
      width: 260px;
      padding: 10px 12px;
      background: var(--surface);
      border: 1px solid var(--border);
      border-radius: var(--r-md);
      box-shadow: var(--shadow-lg, 0 8px 24px rgba(0, 0, 0, 0.12));
      font-size: 12px;
      line-height: 1.5;
      font-weight: 400;
    }
    .info-tip-pop strong {
      display: block;
      margin-bottom: 3px;
      font-size: 12px;
      font-weight: 700;
      color: var(--text);
    }
    .info-tip-pop p {
      margin: 0;
      color: var(--text-muted);
    }
  `,
})
export class InfoTip {
  private readonly hostRef = inject(ElementRef<HTMLElement>);

  readonly term = input.required<string>();
  readonly text = input.required<string>();

  readonly open = signal(false);

  toggle(event: MouseEvent): void {
    event.stopPropagation();
    this.open.update((v) => !v);
  }

  @HostListener('document:click', ['$event'])
  onDocumentClick(event: MouseEvent): void {
    if (this.open() && !this.hostRef.nativeElement.contains(event.target as Node)) {
      this.open.set(false);
    }
  }
}
