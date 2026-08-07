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
      return firstValueFrom(msalService.initialize()).then(() =>
        firstValueFrom(msalService.handleRedirectObservable()),
      );
    }),
  ],
};
