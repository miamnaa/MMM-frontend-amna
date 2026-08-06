import { Component, signal } from '@angular/core';
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

interface Faq {
  question: string;
  answer: string;
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

  readonly faqs: Faq[] = [
    {
      question: 'What is Marketing Mix Modeling?',
      answer:
        'Marketing Mix Modeling estimates how much each channel contributed to revenue, using your historical spend and sales rather than user-level tracking. Because it never needs a cookie or a device ID, it covers TV, retail media and offline spend alongside digital — and it keeps working as tracking gets harder.',
    },
    {
      question: 'Can I compare multiple models?',
      answer:
        'Yes. Every run is stored as its own experiment with the exact configuration that produced it, so you can fit variants side by side and compare contribution, ROI and fit diagnostics before you commit to one.',
    },
    {
      question: 'Can I customize model parameters and transformations?',
      answer:
        'Yes. Model Studio exposes adstock lag and decay, the saturation curve, seasonality, the train/test split and the sampler settings. Nothing important is hidden behind a default you cannot see or change.',
    },
    {
      question: 'What marketing channels can be analyzed?',
      answer:
        'Any channel you have periodic spend or impressions for — paid search, paid social, TV, radio, print, out-of-home, retail media, affiliates and direct mail. Control variables such as price, promotions and distribution sit alongside them so the model does not credit media for something else.',
    },
    {
      question: 'What insights can I expect after running a model?',
      answer:
        'Channel contribution and ROI, response curves showing where each channel starts to saturate, the baseline share of revenue, and the fit diagnostics behind all of it. From there the scenario planner lets you reallocate budget and read the predicted lift.',
    },
  ];

  /** Accordion: one panel open at a time, null when all are closed. */
  readonly openFaq = signal<number | null>(0);

  toggleFaq(index: number): void {
    this.openFaq.update((current) => (current === index ? null : index));
  }
}
