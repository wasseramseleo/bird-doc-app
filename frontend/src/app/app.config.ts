import {
  ApplicationConfig,
  inject,
  LOCALE_ID,
  provideAppInitializer,
  provideBrowserGlobalErrorListeners,
  provideZoneChangeDetection,
} from '@angular/core';
import {provideRouter} from '@angular/router';
import {provideHttpClient, withInterceptors} from '@angular/common/http';
import {registerLocaleData} from '@angular/common';
import localeDeAt from '@angular/common/locales/de-AT';
import {firstValueFrom} from 'rxjs';

import {routes} from './app.routes';
import {authInterceptor} from './core/interceptors/auth.interceptor';
import {AuthService} from './service/auth.service';

// LOCALE_ID is de-AT; register its data so number/date pipes format with Austrian conventions.
registerLocaleData(localeDeAt);

export const appConfig: ApplicationConfig = {
  providers: [
    {provide: LOCALE_ID, useValue: 'de-AT'},
    provideHttpClient(withInterceptors([authInterceptor])),
    provideBrowserGlobalErrorListeners(),
    provideZoneChangeDetection({eventCoalescing: true}),
    provideRouter(routes),
    provideAppInitializer(() => firstValueFrom(inject(AuthService).bootstrap())),
  ],
};
