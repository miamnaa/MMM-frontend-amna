import { Component, input } from '@angular/core';

@Component({
  selector: 'app-page-header',
  template: `
    <div class="page-header">
      <div>
        <h1>{{ title() }}</h1>
        @if (subtitle(); as s) {
          <p class="sub">{{ s }}</p>
        }
      </div>
      <div class="actions">
        <ng-content />
      </div>
    </div>
  `,
  styles: `
    .page-header {
      display: flex;
      align-items: flex-start;
      justify-content: space-between;
      gap: 16px;
      flex-wrap: wrap;
      margin-bottom: 22px;
    }
    .sub {
      margin-top: 4px;
      font-size: 13px;
      color: var(--text-muted);
      max-width: 62ch;
    }
    .actions {
      display: flex;
      align-items: center;
      gap: 8px;
    }
  `,
})
export class PageHeader {
  readonly title = input.required<string>();
  readonly subtitle = input<string | null>(null);
}
