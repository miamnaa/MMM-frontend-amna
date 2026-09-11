import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable, map, throwError } from 'rxjs';

import { environment } from '../../../environments/environment';

const GROK_API_URL = 'https://api.x.ai/v1/chat/completions';
const GROK_MODEL = 'grok-4';

interface GrokChatResponse {
  choices?: { message?: { content?: string } }[];
}

/**
 * Direct browser -> xAI call, by explicit request (2026-09-11) - not the
 * usual pattern for a real API key. Every other credential in this app
 * (the Entra client/tenant IDs) is a public OAuth identifier, safe to ship
 * in a browser bundle; this one is a real secret, and shipping it client-
 * side means anyone who opens dev tools can read it out of the built JS
 * and use it themselves. Flagged explicitly before building this - the
 * user chose to accept that exposure rather than route it through a
 * backend proxy. If that changes, this is the one file to swap for an
 * HTTP call to a real backend endpoint instead.
 */
@Injectable({ providedIn: 'root' })
export class GrokService {
  private readonly http = inject(HttpClient);

  /** False until environment.grokApiKey is actually filled in - callers should check this before calling summarize() so the UI can say "not configured" instead of firing a request that's guaranteed to fail. */
  readonly configured = !!environment.grokApiKey;

  /**
   * One real chat-completion call, no conversation history - system/user
   * prompt in, plain text out. Callers own their own loading/error signal
   * state; this just wraps the real HTTP call and unwraps the real
   * response text.
   */
  summarize(systemPrompt: string, userPrompt: string): Observable<string> {
    if (!environment.grokApiKey) {
      return throwError(() => new Error('AI summary is not configured for this deployment yet - no Grok API key set.'));
    }

    return this.http
      .post<GrokChatResponse>(
        GROK_API_URL,
        {
          model: GROK_MODEL,
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userPrompt },
          ],
          temperature: 0.3,
        },
        { headers: { Authorization: `Bearer ${environment.grokApiKey}` } },
      )
      .pipe(
        map((res) => {
          const text = res.choices?.[0]?.message?.content?.trim();
          if (!text) throw new Error('The AI summary came back empty.');
          return text;
        }),
      );
  }

  /** Same "message" shape as the rest of this app's real backend, but xAI's error body isn't guaranteed to match it - falls back to a generic message per real HTTP status instead of assuming a field that might not be there. */
  friendlyError(err: unknown): string {
    if (err instanceof HttpErrorResponse) {
      if (err.status === 401) return 'The Grok API key for this deployment was rejected - it may be missing, wrong, or revoked.';
      if (err.status === 429) return 'Grok is rate-limiting this deployment right now. Try again in a moment.';
      if (err.status === 0) return "Couldn't reach Grok - check your connection and try again.";
      const message: unknown = (err.error as { error?: { message?: string } } | undefined)?.error?.message;
      if (typeof message === 'string' && message) return message;
    }
    if (err instanceof Error) return err.message;
    return 'Could not generate an AI summary right now. Try again.';
  }
}
