import { Component } from '@angular/core';
import { RouterOutlet } from '@angular/router';

import { Header } from '../../core/header/header';
import { Sidebar } from '../../core/sidebar/sidebar';

@Component({
  selector: 'app-main-layout',
  imports: [RouterOutlet, Header, Sidebar],
  templateUrl: './main-layout.html',
  styleUrl: './main-layout.css',
})
export class MainLayout {}
