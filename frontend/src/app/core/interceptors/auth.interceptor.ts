import {HttpErrorResponse, HttpInterceptorFn} from '@angular/common/http';
import {inject} from '@angular/core';
import {Router} from '@angular/router';
import {catchError, throwError} from 'rxjs';
import {AuthService} from '../../service/auth.service';
import {getCookie} from '../util/cookie';
import {SESSION_EXPIRY_AT_THE_GESTURE} from '../errors/session-expiry';
import {IdentityCacheService} from '../offline/identity-cache';
import {ReferenceBundleCacheService} from '../offline/reference-bundle-cache';

const UNSAFE_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

export const authInterceptor: HttpInterceptorFn = (req, next) => {
  const router = inject(Router);
  const authService = inject(AuthService);
  const identityCache = inject(IdentityCacheService);
  const referenceBundleCache = inject(ReferenceBundleCacheService);

  // Keep the Angular service worker (ngsw) out of the API path entirely (PRD
  // #152). Every request the app makes is dynamic `/api` traffic the SW is not
  // meant to cache — it has no `dataGroups` for it — so left to its own devices
  // the SW intercepts an offline API request and returns a synthetic HTTP 504
  // ("Gateway Timeout"). The whole offline design (DataAccessFacadeService's
  // outbox/cache fallback, AuthService.bootstrap) treats a genuine connectivity
  // failure as `HttpErrorResponse.status === 0`; a 504 is neither 0 nor a real
  // server response, so it slips past every offline check — reads stop falling
  // back to the cache and, worse, a field capture errors out instead of being
  // queued to the durable outbox. This only bit in production, where the SW is
  // active; `ng serve` registers no SW, so dev always saw the real `status === 0`.
  // `ngsw-bypass` tells the SW to ignore the request (see ngsw-worker `onFetch`),
  // so offline API failures surface as `status === 0` in prod exactly as in dev,
  // and a *real* upstream 504 still passes through as a real 504.
  const headers: Record<string, string> = {'ngsw-bypass': 'true'};
  if (UNSAFE_METHODS.has(req.method.toUpperCase())) {
    const csrfToken = getCookie('csrftoken');
    if (csrfToken) {
      headers['X-CSRFToken'] = csrfToken;
    }
  }

  const cloned = req.clone({
    withCredentials: true,
    setHeaders: headers,
  });

  return next(cloned).pipe(
    catchError((err: unknown) => {
      if (err instanceof HttpErrorResponse && err.status === 401 && !isAuthRequest(req.url)) {
        // A confirmed "not authenticated" here is the same signal bootstrap()
        // treats as logout/expiry (issue #156): clear the cached identity, so a
        // later offline boot can't resurrect the expired session. Best effort —
        // an IndexedDB failure here must not block the redirect.
        //
        // Dies geschieht **immer**, auch bei einem Schreibvorgang, der seinen
        // Fehlschlag selbst meldet (#447): das Mitglied darf die Runde
        // zuendebringen, aber der Deckel des geteilten Tablets fällt irgendwann
        // zu, ohne dass jemand „Anmelden" gedrückt hätte. Läge die Identität
        // dann noch im Zwischenspeicher, meldete der nächste Kaltstart ohne
        // Empfang (`AuthService.bootstrap()`, `status === 0`) den Vorigen wieder
        // an — samt seiner Warteschlange. Die Rettung stört das nicht: die
        // Outbox reiht unter `currentUser()` ein, dem Signal im Speicher.
        identityCache.clear().catch(() => undefined);

        // #447 (ADR 0037): meldet der Schreibvorgang seinen Fehlschlag selbst —
        // im Banner dort, wo die Geste stattfand —, dann hält der globale Teil
        // hier zurück. Er käme sonst zuvor: beim Fang-Create *vor* der Rettung
        // (die Outbox reiht unter dem angemeldeten Konto ein, Mandantengrenze
        // aus #160, und das wäre eine Zeile tiefer schon gelöscht — der Fang
        // mit ihm), und beim Fang-Edit *statt* des Banners, indem er das
        // Formular unter den Händen wegnimmt und den `unsavedChangesGuard`
        // (#407) über eine Korrektur fragen lässt, die sonst nirgends steht.
        //
        // Bis das Mitglied „Anmelden" drückt, hält der Klient die Sitzung für
        // gültig, obwohl sie es nicht mehr ist — bewusst: nur so kennt die
        // Outbox noch das Konto, unter dem der nächste Fang einzureihen ist,
        // und nur so bleibt das Referenz-Bündel (#158) da, aus dem die
        // Erfassung weiterläuft. Der Knopf im Banner ruft
        // `AuthService.sessionExpired()`, das beides nachholt. Jede andere
        // Antwort des Servers, auch jeder Ladevorgang, räumt unverändert hier
        // auf.
        if (!req.context.get(SESSION_EXPIRY_AT_THE_GESTURE)) {
          authService.currentUser.set(null);
          // Also clear the org-scoped reference-bundle cache (issue #158) — a
          // shared device left signed out here must not leave the next
          // Mitglied's offline boot inheriting this Organisation's cached
          // reference data.
          referenceBundleCache.clear().catch(() => undefined);
          const next = router.url && router.url !== '/login' ? router.url : '/';
          router.navigate(['/login'], {queryParams: {next}});
        }
      }
      return throwError(() => err);
    }),
  );
};

function isAuthRequest(url: string): boolean {
  return url.includes('/api/auth/');
}
