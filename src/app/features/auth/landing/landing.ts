import { Component, signal } from '@angular/core';
import { RouterLink } from '@angular/router';

interface Benefit {
  icon: string;
  title: string;
  body: string;
}

interface Move {
  number: string;
  label: string;
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
  readonly benefits: Benefit[] = [
    {
      icon: '◱',
      title: 'Unify every channel',
      body: 'Paid, retail media, TV, and offline spend land in one model — no spreadsheet stitching.',
    },
    {
      icon: '◫',
      title: 'Simulate the budget',
      body: 'Move £1m between channels and see the modeled revenue shift before you spend it.',
    },
    {
      icon: '◈',
      title: 'Defend the answer',
      body: 'Every coefficient is traceable — walk finance through the model, not a black box.',
    },
  ];

  readonly moves: Move[] = [
    {
      number: '01',
      label: 'Connect your data',
      body: 'Spend, sales, and pricing feeds pull in automatically — no data team required.',
    },
    {
      number: '02',
      label: 'ROIVIO builds the model',
      body: 'Bayesian MMM decomposes revenue into base, media, and external drivers.',
    },
    {
      number: '03',
      label: 'You act on it',
      body: 'Reallocate budget, plan next quarter, and export a board-ready readout.',
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
