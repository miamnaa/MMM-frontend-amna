import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { EnvironmentProviders, Provider } from '@angular/core';
import { provideRouter } from '@angular/router';
import { MsalService } from '@azure/msal-angular';
import { of } from 'rxjs';

/**
 * Stands in for the real MsalService, which needs a live PublicClientApplication
 * and a browser popup - neither exists in a unit test. Login/logout resolve
 * immediately so components exercising the happy path don't hang.
 */
class MsalServiceStub {
  loginPopup() {
    return of(null);
  }
  logoutPopup() {
    return of(undefined);
  }
  initialize() {
    return of(undefined);
  }
  handleRedirectObservable() {
    return of(null);
  }
}

/**
 * Providers every component spec needs: components read data through services
 * that inject HttpClient, and most templates use routerLink. MsalService is
 * stubbed since sign-in/out components now inject it directly.
 */
export function testProviders(): (Provider | EnvironmentProviders)[] {
  return [
    provideHttpClient(),
    provideHttpClientTesting(),
    provideRouter([]),
    { provide: MsalService, useClass: MsalServiceStub },
  ];
}
