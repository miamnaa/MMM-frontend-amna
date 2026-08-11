import { MsalService } from '@azure/msal-angular';

import { THEME_STORAGE_KEY } from '../services/theme.service';

/**
 * Local sign-out only - never logoutRedirect()/logoutPopup(). Those hit
 * Microsoft's own end-session endpoint, which would sign the user out of
 * every other Microsoft app they have open too, not just this one. This
 * clears only what this app itself keeps: MSAL's cached tokens/account, and
 * anything else in browser storage.
 *
 * Calls instance.clearCache() as requested, but doesn't trust it alone -
 * msal-browser's own error handling can swallow a failure inside clearCache()
 * and still resolve as if it succeeded, which previously meant sign-out
 * looked like it worked while a stale session actually survived. Wiping
 * localStorage/sessionStorage directly afterwards guarantees the result
 * regardless of what clearCache() itself reports. The theme preference is
 * the only other thing this app keeps in storage, so it's saved and
 * restored around the wipe rather than lost.
 *
 * Ends with a full page reload (window.location.href), not router.navigate().
 * A router-only navigation leaves this tab's running app - SessionService's
 * cached user signal, TunnelService, every in-memory singleton - untouched
 * even though storage is clean. A hard reload restarts the whole app from
 * zero, so nothing in this tab still thinks someone is signed in afterwards.
 *
 * Tradeoff: this signs out of this app only, not the Microsoft/Windows-level
 * session - clicking "Sign in with Microsoft" right after can silently
 * re-authenticate via that still-active SSO session. That's expected for an
 * app that only signs itself out.
 */
export async function localSignOut(msalService: MsalService): Promise<void> {
  const theme = localStorage.getItem(THEME_STORAGE_KEY);

  try {
    await msalService.instance.clearCache();
  } catch {
    // Covered by the direct wipe below regardless of whether this succeeded.
  }

  localStorage.clear();
  sessionStorage.clear();
  if (theme !== null) localStorage.setItem(THEME_STORAGE_KEY, theme);

  window.location.href = '/login';
}
