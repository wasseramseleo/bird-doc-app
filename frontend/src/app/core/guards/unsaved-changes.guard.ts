import {inject} from '@angular/core';
import {CanDeactivateFn} from '@angular/router';
import {Observable} from 'rxjs';

import {UnsavedChangesService} from '../../service/unsaved-changes.service';

// Issue #407 (ADR 0032): the app's first CanDeactivate guard. Leaving the
// capture form with unsaved input now asks first — whatever triggered the
// navigation. That includes the bare `n` shortcut (`app.ts`, issue #339), which
// navigates to a fresh capture form from anywhere and until now threw an
// in-progress form away with no guard at all: a latent bug, not a precedent.
//
// The dirty state itself lives in the form; UnsavedChangesService is the seam,
// so the nav bar's "Jetzt aktualisieren" can ask the same question before a
// Version adoption reloads the tab.
export const unsavedChangesGuard: CanDeactivateFn<unknown> = (): Observable<boolean> =>
  inject(UnsavedChangesService).confirmDiscard();
