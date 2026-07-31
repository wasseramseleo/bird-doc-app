import {
  ApplicationConfig,
  inject,
  isDevMode,
  LOCALE_ID,
  provideAppInitializer,
  provideBrowserGlobalErrorListeners,
  provideZoneChangeDetection,
} from '@angular/core';
import {provideRouter} from '@angular/router';
import {provideHttpClient, withInterceptors} from '@angular/common/http';
import {registerLocaleData} from '@angular/common';
import localeDeAt from '@angular/common/locales/de-AT';
import {provideServiceWorker} from '@angular/service-worker';
import {firstValueFrom} from 'rxjs';

import {routes} from './app.routes';
import {authInterceptor} from './core/interceptors/auth.interceptor';
import {failureInterceptor} from './core/interceptors/failure.interceptor';
import {AuthService} from './service/auth.service';

// LOCALE_ID is de-AT; register its data so number/date pipes format with Austrian conventions.
registerLocaleData(localeDeAt);

/**
 * Die HTTP-Interceptor-Kette, in genau dieser Reihenfolge — und die Reihenfolge
 * ist Vertrag (ADR 0037, PRD #438).
 *
 * `failureInterceptor` steht **außen**: er ordnet jeden Fehler ein, der aus der
 * Kette heraufkommt — auch einen, den ein innerer Interceptor selbst wirft —,
 * während der `authInterceptor` darunter den **rohen** Fehler weiter sieht und
 * seine 401-Arbeit unverändert tut. Exportiert, damit die Reihenfolge geprüft
 * werden kann statt versprochen zu sein (`failure.interceptor.spec.ts`).
 */
export const HTTP_INTERCEPTORS_IN_ORDER = [failureInterceptor, authInterceptor];

export const appConfig: ApplicationConfig = {
  providers: [
    {provide: LOCALE_ID, useValue: 'de-AT'},
    provideHttpClient(withInterceptors(HTTP_INTERCEPTORS_IN_ORDER)),
    provideBrowserGlobalErrorListeners(),
    provideZoneChangeDetection({eventCoalescing: true}),
    provideRouter(routes),
    provideAppInitializer(() => firstValueFrom(inject(AuthService).bootstrap())),
    // App-shell caching only (issue #156): config-driven via ngsw-config.json, no
    // hand-written service worker. Disabled in dev so `ng serve` never serves a
    // stale cached shell; only the production build registers it.
    provideServiceWorker('ngsw-worker.js', {
      enabled: !isDevMode(),
      registrationStrategy: 'registerWhenStable:30000',
    }),
  ],
};
