import { Routes } from '@angular/router';
import { MsalGuard } from '@azure/msal-angular';

import { datasetContextGuard } from './core/auth/dataset-context.guard';
import { otpGuard } from './core/auth/otp.guard';
import { projectContextGuard } from './core/auth/project-context.guard';
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
    path: 'verify',
    title: 'Verify your email · ROIVIO',
    // MsalGuard only, not otpGuard — this is the screen that produces the
    // "verified" state, so it can't also require it to be entered.
    canActivate: [MsalGuard],
    loadComponent: () => import('./features/auth/verify/verify').then((m) => m.Verify),
  },
  // --- The tunnel: Project list → Upload Data → Configure. Bare pages, no
  // MainLayout/sidebar - each declares its own guard chain directly rather
  // than inheriting via canActivateChild, since they're not nested under a
  // shared layout anymore.
  {
    path: 'projects',
    title: 'Projects · ROIVIO',
    canActivate: [MsalGuard, otpGuard],
    loadComponent: () => import('./features/projects/projects').then((m) => m.Projects),
  },
  {
    path: 'upload-data/:projectId',
    title: 'Upload data · ROIVIO',
    // projectContextGuard checks the :projectId in the URL against the real
    // Projects API, so a direct hit / bookmark / refresh here still gets
    // validated rather than trusting whatever's in the address bar.
    canActivate: [MsalGuard, otpGuard, projectContextGuard],
    loadComponent: () => import('./features/upload-data/upload-data').then((m) => m.UploadData),
  },
  {
    path: 'configure/:projectId',
    title: 'Configure · ROIVIO',
    // datasetContextGuard checks in-memory TunnelService state - Configure
    // has no real backend yet, so this is the best available "did Upload
    // Data actually happen this session" check.
    canActivate: [MsalGuard, otpGuard, datasetContextGuard],
    loadComponent: () => import('./features/configure/configure').then((m) => m.Configure),
  },
  {
    path: '',
    component: MainLayout,
    // Kept as real, guarded routes for later - nothing links to them from
    // the tunnel anymore, but they still work if reached directly.
    // MsalGuard on canActivateChild, not per-child canActivate: one place to
    // update, and it also covers routes added here later. otpGuard runs
    // after it, so "signed into Microsoft" and "completed the email code
    // step" are both required for every page under this layout.
    canActivateChild: [MsalGuard, otpGuard],
    children: [
      {
        path: 'overview',
        title: 'Overview · ROIVIO',
        loadComponent: () => import('./features/overview/overview').then((m) => m.Overview),
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
