import { Routes } from '@angular/router';
import { MsalGuard } from '@azure/msal-angular';

import { calibrateContextGuard } from './core/auth/calibrate-context.guard';
import { datasetContextGuard } from './core/auth/dataset-context.guard';
import { hyperparametersContextGuard } from './core/auth/hyperparameters-context.guard';
import { optimizeContextGuard } from './core/auth/optimize-context.guard';
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
  {
    path: '',
    // No layout component here on purpose (2026-08-13) - Projects and the
    // model-build tunnel screens show no left Sidebar or shared top bar.
    // Models moved back under MainLayout below for the left Sidebar. The
    // tunnel screens' own TunnelSteps sidebar has a "← Back" link (to
    // /models/:projectId) instead; this is just a guard-only grouping node.
    canActivateChild: [MsalGuard, otpGuard],
    children: [
      {
        path: 'projects',
        title: 'Projects · ROIVIO',
        loadComponent: () => import('./features/projects/projects').then((m) => m.Projects),
      },
      {
        path: 'upload-data/:projectId',
        title: 'Upload data · ROIVIO',
        // projectContextGuard checks the :projectId in the URL against the
        // real Projects API, so a direct hit / bookmark / refresh here
        // still gets validated rather than trusting the address bar.
        canActivate: [projectContextGuard],
        loadComponent: () => import('./features/upload-data/upload-data').then((m) => m.UploadData),
      },
      {
        path: 'configure/:projectId/:datasetId',
        title: 'Configure · ROIVIO',
        // datasetContextGuard checks TunnelService, falling back to a real
        // listForProject() re-fetch on a fresh tab/reload - see
        // stage-context-guard.ts.
        canActivate: [datasetContextGuard],
        loadComponent: () => import('./features/configure/configure').then((m) => m.Configure),
      },
      {
        path: 'optimize/:projectId/:datasetId',
        title: 'Optimize · ROIVIO',
        canActivate: [optimizeContextGuard],
        loadComponent: () => import('./features/optimize/optimize').then((m) => m.Optimize),
      },
      {
        path: 'calibrate/:projectId/:datasetId',
        title: 'Calibrate · ROIVIO',
        canActivate: [calibrateContextGuard],
        loadComponent: () => import('./features/calibrate/calibrate').then((m) => m.Calibrate),
      },
      {
        path: 'hyperparameters/:projectId/:datasetId',
        title: 'Hyperparameterization · ROIVIO',
        canActivate: [hyperparametersContextGuard],
        loadComponent: () =>
          import('./features/hyperparameters/hyperparameters').then((m) => m.Hyperparameters),
      },
    ],
  },
  {
    path: '',
    component: MainLayout,
    // Models is back here (2026-08-13) for the left Sidebar - Projects
    // stays standalone (see above), only Models shows it, per an explicit
    // "I want this sidebar in that model page" correction. What's left here
    // besides Models (Overview, Datasets, Experiments, Model Studio,
    // Results, Scenarios, Settings) stays as real, guarded routes for
    // later - nothing links to most of them from anywhere active, but they
    // still work if reached directly. MsalGuard on canActivateChild, not
    // per-child canActivate: one place to update, and it also covers routes
    // added here later. otpGuard runs after it, so "signed into Microsoft"
    // and "completed the email code step" are both required for every page
    // under this layout.
    canActivateChild: [MsalGuard, otpGuard],
    children: [
      {
        path: 'models/:projectId',
        title: 'Models · ROIVIO',
        // Project hub between the Project list and the per-model tunnel -
        // real dataset list, real computed status per model.
        canActivate: [projectContextGuard],
        loadComponent: () => import('./features/project-models/project-models').then((m) => m.ProjectModels),
      },
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
          import('./features/results-projects/results-projects').then((m) => m.ResultsProjects),
      },
      {
        path: 'results/:projectId',
        title: 'Results & Insights · ROIVIO',
        canActivate: [projectContextGuard],
        loadComponent: () =>
          import('./features/results-projects/results-projects').then((m) => m.ResultsProjects),
      },
      {
        path: 'results/:projectId/:datasetId',
        title: 'Model results · ROIVIO',
        canActivate: [projectContextGuard],
        loadComponent: () =>
          import('./features/model-results/model-results').then((m) => m.ModelResults),
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
