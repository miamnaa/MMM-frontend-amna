import { HTTP_INTERCEPTORS, provideHttpClient, withFetch, withInterceptorsFromDi } from '@angular/common/http';
import {
  ApplicationConfig,
  importProvidersFrom,
  inject,
  provideAppInitializer,
  provideBrowserGlobalErrorListeners,
} from '@angular/core';
import { provideRouter, withComponentInputBinding, withInMemoryScrolling } from '@angular/router';
import { MsalInterceptor, MsalModule, MsalService } from '@azure/msal-angular';
import { firstValueFrom } from 'rxjs';

import {
  msalGuardConfigFactory,
  msalInstanceFactory,
  msalInterceptorConfigFactory,
} from './core/auth/auth-config';
import { routes } from './app.routes';

export const appConfig: ApplicationConfig = {
  providers: [
    provideBrowserGlobalErrorListeners(),
    // withInterceptorsFromDi bridges the classic HTTP_INTERCEPTORS token into
    // the fetch-based client - MsalInterceptor is registered that way below,
    // and provideHttpClient ignores DI interceptors unless this is present.
    provideHttpClient(withFetch(), withInterceptorsFromDi()),
    provideRouter(
      routes,
      withComponentInputBinding(),
      withInMemoryScrolling({ scrollPositionRestoration: 'top' }),
    ),
    importProvidersFrom(
      MsalModule.forRoot(
        msalInstanceFactory(),
        msalGuardConfigFactory(),
        msalInterceptorConfigFactory(),
      ),
    ),
    {
      provide: HTTP_INTERCEPTORS,
      useClass: MsalInterceptor,
      multi: true,
    },
    provideAppInitializer(() => {
      const msalService = inject(MsalService);
      // MsalGuard re-runs handleRedirectObservable itself on every
      // activation, so calling it here too is safe - msal-browser memoizes
      // the response and only processes an auth code once. This call exists
      // for the pages the guard never touches (login, signup, landing),
      // which still need initialize() to run before any MSAL API is usable.
      return firstValueFrom(msalService.initialize())
        .then(() => firstValueFrom(msalService.handleRedirectObservable()))
        .then((result) => {
          if (result?.account) {
            msalService.instance.setActiveAccount(result.account);
            return;
          }
          // Returning user, no redirect in flight this load - make sure a
          // cached session from before still resolves to an active account.
          const accounts = msalService.instance.getAllAccounts();
          if (accounts.length > 0 && !msalService.instance.getActiveAccount()) {
            msalService.instance.setActiveAccount(accounts[0]);
          }
        });
    }),
  ],
};
