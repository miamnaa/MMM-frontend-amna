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
      postLogoutRedirectUri: window.location.origin,
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

/** Popup, not redirect - a redirect would blow away the whole SPA state on every sign-in. */
export function msalGuardConfigFactory(): MsalGuardConfiguration {
  return {
    interactionType: InteractionType.Popup,
    authRequest: {
      scopes: API_SCOPES,
    },
    // If the popup is dismissed rather than completed, land on the real
    // sign-in page instead of leaving the guard's own error unhandled.
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
    interactionType: InteractionType.Popup,
    protectedResourceMap,
  };
}
