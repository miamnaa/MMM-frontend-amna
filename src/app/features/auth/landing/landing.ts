import { Component } from '@angular/core';
import { RouterLink } from '@angular/router';

interface Feature {
  icon: string;
  title: string;
  body: string;
}

interface Step {
  number: string;
  title: string;
  body: string;
}

@Component({
  selector: 'app-landing',
  imports: [RouterLink],
  templateUrl: './landing.html',
  styleUrl: './landing.css',
})
export class Landing {
  readonly features: Feature[] = [
    {
      icon: '↥',
      title: 'Bring your own data',
      body: 'Upload weekly spend, impressions and revenue. Every file is validated against the expected schema before a model ever sees it.',
    },
    {
      icon: '⚙',
      title: 'Two proven engines',
      body: 'Fit with Google Meridian or PyMC-Marketing. Adstock, saturation and seasonality are configurable, not hidden.',
    },
    {
      icon: '◨',
      title: 'Answers you can defend',
      body: 'Contribution, ROI and response curves come with the fit diagnostics — R², MAPE, convergence — so you know what to trust.',
    },
    {
      icon: '◈',
      title: 'Plan the next quarter',
      body: 'Move budget between channels and read the predicted lift straight off the curves the model actually fitted.',
    },
  ];

  readonly steps: Step[] = [
    {
      number: '01',
      title: 'Create a project',
      body: 'Group the datasets and runs that answer one business question, and pick your modeling engine.',
    },
    {
      number: '02',
      title: 'Upload and validate',
      body: 'Files stream straight to secure storage. Schema problems are reported column by column, before you waste a run.',
    },
    {
      number: '03',
      title: 'Configure and run',
      body: 'Set the transforms in Model Studio. Runs are queued to a worker, so nothing times out in the browser.',
    },
    {
      number: '04',
      title: 'Read and iterate',
      body: 'Review contribution and saturation, adjust the configuration, and run again until the model holds up.',
    },
  ];
}
