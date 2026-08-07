import { Routes } from '@angular/router';
import { MsalGuard } from '@azure/msal-angular';

import { MainLayout } from './layouts/main-layout/main-layout';

export const routes: Routes = [
  {
    path: '',
    pathMatch: 'full',
    title: 'ROIVIO · Marketing Mix Modeling',
    loadComponent: () => import('./features/auth/landing/landing').then((m) => m.Landing),
  },
  {
    path: 'login',
    title: 'Sign in · ROIVIO',
    loadComponent: () => import('./features/auth/login/login').then((m) => m.Login),
  },
  {
    path: 'signup',
    title: 'Create your account · ROIVIO',
    loadComponent: () => import('./features/auth/signup/signup').then((m) => m.Signup),
  },
  {
    path: '',
    component: MainLayout,
    // MsalGuard on canActivateChild, not per-child canActivate: one place to
    // update, and it also covers routes added here later.
    canActivateChild: [MsalGuard],
    children: [
      {
        path: 'overview',
        title: 'Overview · ROIVIO',
        loadComponent: () => import('./features/overview/overview').then((m) => m.Overview),
      },
      {
        path: 'projects',
        title: 'Projects · ROIVIO',
        loadComponent: () => import('./features/projects/projects').then((m) => m.Projects),
      },
      {
        path: 'datasets',
        title: 'Datasets · ROIVIO',
        loadComponent: () => import('./features/datasets/datasets').then((m) => m.Datasets),
      },
      {
        path: 'experiments',
        title: 'Experiments · ROIVIO',
        loadComponent: () => import('./features/experiments/experiments').then((m) => m.Experiments),
      },
      {
        path: 'model-studio',
        title: 'Model Studio · ROIVIO',
        loadComponent: () => import('./features/models/models').then((m) => m.Models),
      },
      {
        path: 'model-studio/:experimentId',
        title: 'Model Studio · ROIVIO',
        loadComponent: () => import('./features/models/models').then((m) => m.Models),
      },
      {
        path: 'results',
        title: 'Results & Insights · ROIVIO',
        loadComponent: () =>
          import('./features/results-dashboard/results-dashboard').then((m) => m.ResultsDashboard),
      },
      {
        path: 'results/:experimentId',
        title: 'Results & Insights · ROIVIO',
        loadComponent: () =>
          import('./features/results-dashboard/results-dashboard').then((m) => m.ResultsDashboard),
      },
      {
        path: 'scenarios',
        title: 'Scenario Planner · ROIVIO',
        loadComponent: () => import('./features/scenarios/scenarios').then((m) => m.Scenarios),
      },
      {
        path: 'settings',
        title: 'Settings · ROIVIO',
        loadComponent: () => import('./features/settings/settings').then((m) => m.Settings),
      },
    ],
  },
  { path: '**', redirectTo: '' },
];
