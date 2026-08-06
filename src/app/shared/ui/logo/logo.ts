import { Component, computed, input } from '@angular/core';

/** Instance counter so each gradient gets a unique id when several render together. */
let uid = 0;

/**
 * The ROIVIO mark: a response curve rising into a saturation point — the shape
 * the product actually models. One source of truth for every surface.
 */
@Component({
  selector: 'app-logo',
  template: `
    <svg
      class="logo"
      viewBox="0 0 64 64"
      [style.width.px]="size()"
      [style.height.px]="size()"
      [style.border-radius.px]="size() / 4"
      aria-hidden="true"
    >
      <defs>
        <linearGradient [attr.id]="gradientId" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stop-color="#12a066" />
          <stop offset="100%" stop-color="#077045" />
        </linearGradient>
      </defs>
      <rect width="64" height="64" rx="16" [attr.fill]="fill()" />
      <path
        d="M14 46c9 0 13-9 19-16 4-5 9-8 17-9"
        fill="none"
        stroke="#fff"
        stroke-width="5"
        stroke-linecap="round"
      />
      <circle cx="49" cy="21" r="4.5" fill="#8ad0a7" />
    </svg>
  `,
  styles: `
    :host {
      display: inline-flex;
      flex: none;
    }
    .logo {
      display: block;
    }
  `,
})
export class Logo {
  readonly size = input<number>(30);
  /** Flat fill reads better at small sizes, where a gradient turns to mud. */
  readonly flat = input<boolean>(false);

  protected readonly gradientId = `roivio-mark-${uid++}`;
  protected readonly fill = computed(() =>
    this.flat() ? '#0a8654' : `url(#${this.gradientId})`,
  );
}
