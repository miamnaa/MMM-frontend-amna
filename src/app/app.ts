import { Component } from '@angular/core';
import { RouterOutlet } from '@angular/router';

/** Root shell. All chrome lives in MainLayout so auth pages can bypass it later. */
@Component({
  selector: 'app-root',
  imports: [RouterOutlet],
  template: '<router-outlet />',
})
export class App {}
