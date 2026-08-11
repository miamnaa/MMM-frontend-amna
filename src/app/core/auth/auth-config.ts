import {
  BrowserCacheLocation,
  InteractionType,
  LogLevel,
  PublicClientApplication,
} from '@azure/msal-browser';
import type {
  Configuration,
  IPublicClientApplication,
} from '@azure/msal-browser';
import type {
  MsalGuardConfiguration,
  MsalInterceptorConfiguration, 
} from '@azure/msal-angular';

import { environment } from '../../../environments/environment';

/**
 * The single scope the backend actually validates. Every acquireToken call —
 * login, silent refresh, the interceptor — asks for exactly this, so the
 * access token in hand always matches what `/api/v1/*` expects.
 */
export const API_SCOPES = [environment.entra.apiScope];

/**
 * redirectUri is computed at runtime rather than hardcoded so the same build
 * is correct on localhost and on whatever the deployed origin turns out to
 * be — Vercel preview URLs included.
 */
export function msalConfig(): Configuration {
  return {
    auth: {
      clientId: environment.entra.clientId,
      authority: `https://login.microsoftonline.com/${environment.entra.tenantId}`,
      redirectUri: window.location.origin,
      postLogoutRedirectUri: `${window.location.origin}/login`,
    },
    cache: {
      cacheLocation: BrowserCacheLocation.LocalStorage,
    },
    system: {
      loggerOptions: {
        loggerCallback: (level, message, containsPii) => {
          if (containsPii) return;
          if (level === LogLevel.Error) console.error(message);
        },
        logLevel: environment.production ? LogLevel.Warning : LogLevel.Info,
      },
    },
  };
}

export function msalInstanceFactory(): IPublicClientApplication {
  return new PublicClientApplication(msalConfig());
}

/**
 * Redirect, not popup. Popup completion depends on the main window reading
 * `window.opener` off the popup once Microsoft redirects it back — a
 * Cross-Origin-Opener-Policy header (Vercel's default, or Angular's) blocks
 * exactly that, so the popup finishes a real sign-in and the app never finds
 * out. Redirect has no second window, so there's nothing for COOP to sever.
 */
export function msalGuardConfigFactory(): MsalGuardConfiguration {
  return {
    interactionType: InteractionType.Redirect,
    authRequest: {
      scopes: API_SCOPES,
    },
    // If the redirect flow errors out, land on the real sign-in page
    // instead of leaving the guard's own error unhandled.
    loginFailedRoute: '/login',
  };
}

/**
 * Every call to the real backend gets a bearer token for our own API scope.
 * Keyed by the base URL from environment.ts, so ProjectService and friends
 * need no per-call changes - the interceptor is the only thing that knows
 * about tokens.
 */
export function msalInterceptorConfigFactory(): MsalInterceptorConfiguration {
  const protectedResourceMap = new Map<string, Array<string> | null>();
  protectedResourceMap.set(`${environment.apiBaseUrl}/*`, API_SCOPES);

  return {
    // Matches the guard - an interactive token refresh from here would open
    // a popup while the guard uses redirect, and MSAL doesn't like the two
    // interaction types racing each other.
    interactionType: InteractionType.Redirect,
    protectedResourceMap,
  };
}
