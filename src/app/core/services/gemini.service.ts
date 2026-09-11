import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable, map, throwError } from 'rxjs';

import { environment } from '../../../environments/environment';

/**
 * gemini-2.0-flash was retired live during testing 2026-09-11 - Google's
 * own 404 response named gemini-3.6-flash as the direct replacement, so
 * that's what this points to now. Model names get retired periodically;
 * if this one starts 404ing too, the error body itself usually names the
 * real current replacement - check that before guessing. Current
 * free-tier list: aistudio.google.com.
 */
const GEMINI_MODEL = 'gemini-3.6-flash';
const GEMINI_API_URL = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`;

interface GeminiResponse {
  candidates?: { content?: { parts?: { text?: string }[] } }[];
}

/**
 * Direct browser -> Google call, same real tradeoff as the Grok version
 * this replaced (2026-09-11, at explicit request - a Gemini API key has a
 * genuine free tier, unlike the xAI team this app first tried, which had
 * no credits set up). The key is still a real secret shipped in the
 * browser bundle, not routed through a backend proxy - anyone who opens
 * dev tools on a deployment with a key configured can read it out of the
 * built JS. Google's key also accepts request restrictions (HTTP referrer
 * allowlisting) in AI Studio/Cloud Console, which is worth setting for a
 * public deployment even though it isn't done automatically here.
 */
@Injectable({ providedIn: 'root' })
export class GeminiService {
  private readonly http = inject(HttpClient);

  /** False until environment.geminiApiKey is actually filled in - callers should check this before calling summarize() so the UI can say "not configured" instead of firing a request that's guaranteed to fail. */
  readonly configured = !!environment.geminiApiKey;

  /**
   * One real generateContent call, no conversation history - system/user
   * prompt in, plain text out. Callers own their own loading/error signal
   * state; this just wraps the real HTTP call and unwraps the real
   * response text.
   */
  summarize(systemPrompt: string, userPrompt: string): Observable<string> {
    if (!environment.geminiApiKey) {
      return throwError(() => new Error('AI summary is not configured for this deployment yet - no Gemini API key set.'));
    }

    return this.http
      .post<GeminiResponse>(
        `${GEMINI_API_URL}?key=${encodeURIComponent(environment.geminiApiKey)}`,
        {
          contents: [{ role: 'user', parts: [{ text: userPrompt }] }],
          systemInstruction: { parts: [{ text: systemPrompt }] },
          generationConfig: { temperature: 0.3 },
        },
      )
      .pipe(
        map((res) => {
          const text = res.candidates?.[0]?.content?.parts?.[0]?.text?.trim();
          if (!text) throw new Error('The AI summary came back empty.');
          return text;
        }),
      );
  }

  /** Google's real error body: { error: { code, message, status } } - message is the one field worth surfacing directly, since it's usually specific (a bad key, a disabled API, a quota limit). */
  friendlyError(err: unknown): string {
    if (err instanceof HttpErrorResponse) {
      const message: unknown = (err.error as { error?: { message?: string } } | undefined)?.error?.message;
      if (typeof message === 'string' && message) return message;
      if (err.status === 400) return 'The Gemini API key for this deployment was rejected - it may be missing, wrong, or revoked.';
      if (err.status === 429) return 'Gemini is rate-limiting this deployment right now (free-tier limits are low). Try again in a moment.';
      if (err.status === 0) return "Couldn't reach Gemini - check your connection and try again.";
    }
    if (err instanceof Error) return err.message;
    return 'Could not generate an AI summary right now. Try again.';
  }
}
