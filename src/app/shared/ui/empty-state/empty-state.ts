import { Component, input } from '@angular/core';

@Component({
  selector: 'app-empty-state',
  template: `
    <div class="empty">
      <div class="icon" aria-hidden="true">{{ icon() }}</div>
      <h3>{{ title() }}</h3>
      <p class="muted">{{ message() }}</p>
      <div class="slot"><ng-content /></div>
    </div>
  `,
  styles: `
    .empty {
      display: flex;
      flex-direction: column;
      align-items: center;
      text-align: center;
      gap: 6px;
      padding: 56px 24px;
    }
    .icon {
      width: 44px;
      height: 44px;
      display: grid;
      place-items: center;
      margin-bottom: 6px;
      border-radius: var(--r-md);
      background: var(--gray-100);
      font-size: 20px;
    }
    .muted { max-width: 44ch; }
    .slot:not(:empty) { margin-top: 12px; }
  `,
})
export class EmptyState {
  readonly icon = input<string>('◇');
  readonly title = input.required<string>();
  readonly message = input<string>('');
}
