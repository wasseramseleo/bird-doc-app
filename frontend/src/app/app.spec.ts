import { Component, DestroyRef, inject } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { MatDialog } from '@angular/material/dialog';
import { of } from 'rxjs';

import { App } from './app';
import { unsavedChangesGuard } from './core/guards/unsaved-changes.guard';
import { UnsavedChangesService } from './service/unsaved-changes.service';
import { ConfirmDialogComponent } from './shared/confirm-dialog/confirm-dialog';

describe('App', () => {
  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [App],
      providers: [
        provideRouter([]),
        provideHttpClient(),
        provideHttpClientTesting(),
        provideNoopAnimations(),
      ],
    }).compileComponents();
  });

  it('should create the app', () => {
    const fixture = TestBed.createComponent(App);
    const app = fixture.componentInstance;
    expect(app).toBeTruthy();
  });

  // Issue #339: the app-wide "n" shortcut opens a fresh capture form. It lives as
  // a single document-level keydown handler in the app shell and is guarded so it
  // never fires while the user is typing into an editable control.
  describe('global "n" shortcut for a new capture form (#339)', () => {
    let navSpy: jasmine.Spy;
    const cleanup: HTMLElement[] = [];

    function setup(): void {
      const fixture = TestBed.createComponent(App);
      const router = TestBed.inject(Router);
      navSpy = spyOn(router, 'navigateByUrl');
      fixture.detectChanges();
    }

    function focusEditable(tag: 'input' | 'textarea' | 'select'): HTMLElement {
      const el = document.createElement(tag);
      if (tag === 'input') {
        (el as HTMLInputElement).type = 'text';
      }
      if (tag === 'select') {
        const option = document.createElement('option');
        el.appendChild(option);
      }
      document.body.appendChild(el);
      cleanup.push(el);
      el.focus();
      return el;
    }

    // The app renders no native <select>s — every picker is an Angular Material
    // <mat-select>. Reproduce that focusable host (and its overlay panel/trigger
    // roles) with a plain element carrying a tabindex so document.activeElement
    // actually lands on it.
    function focusFocusable(
      tag: string,
      attrs: Record<string, string> = {},
    ): HTMLElement {
      const el = document.createElement(tag);
      el.setAttribute('tabindex', '0');
      Object.entries(attrs).forEach(([name, value]) => el.setAttribute(name, value));
      document.body.appendChild(el);
      cleanup.push(el);
      el.focus();
      return el;
    }

    afterEach(() => {
      cleanup.forEach((el) => el.remove());
      cleanup.length = 0;
    });

    it('navigates to a fresh capture form when "n" is pressed with focus on the page body', () => {
      setup();
      // Nothing editable is focused: the active element is the page body.
      (document.activeElement as HTMLElement | null)?.blur();

      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'n', bubbles: true }));

      expect(navSpy).toHaveBeenCalledWith('/data-entry');
    });

    it('is inert while a text input is focused — the key types natively, no navigation', () => {
      setup();
      const input = focusEditable('input');
      expect(document.activeElement).toBe(input);

      input.dispatchEvent(new KeyboardEvent('keydown', { key: 'n', bubbles: true }));

      expect(navSpy).not.toHaveBeenCalled();
    });

    it('is inert while a select is focused', () => {
      setup();
      const select = focusEditable('select');
      expect(document.activeElement).toBe(select);

      select.dispatchEvent(new KeyboardEvent('keydown', { key: 'n', bubbles: true }));

      expect(navSpy).not.toHaveBeenCalled();
    });

    it('is inert while a textarea is focused', () => {
      setup();
      const textarea = focusEditable('textarea');
      expect(document.activeElement).toBe(textarea);

      textarea.dispatchEvent(new KeyboardEvent('keydown', { key: 'n', bubbles: true }));

      expect(navSpy).not.toHaveBeenCalled();
    });

    // Regression for the real UI: every select in the app is a Material
    // <mat-select>, never a native <select>. A single-character option shortcut
    // (e.g. small_feather_app's `n`) bubbles up from the mat-select — the shell
    // must not treat that as a navigation trigger and blow away the form/dialog.
    it('is inert while a <mat-select> host is focused', () => {
      setup();
      const matSelect = focusFocusable('mat-select', { role: 'combobox' });
      expect(document.activeElement).toBe(matSelect);

      matSelect.dispatchEvent(new KeyboardEvent('keydown', { key: 'n', bubbles: true }));

      expect(navSpy).not.toHaveBeenCalled();
    });

    it('is inert while a role="listbox" overlay panel option is focused', () => {
      setup();
      // The open mat-select overlay is a role=listbox DIV; keyboard focus can
      // land on it (or an option inside it) while choosing an option.
      const panel = focusFocusable('div', { role: 'listbox' });
      const option = document.createElement('div');
      option.setAttribute('role', 'option');
      option.setAttribute('tabindex', '0');
      panel.appendChild(option);
      option.focus();
      expect(document.activeElement).toBe(option);

      option.dispatchEvent(new KeyboardEvent('keydown', { key: 'n', bubbles: true }));

      expect(navSpy).not.toHaveBeenCalled();
    });

    it('ignores modifier combos — Ctrl+N stays a browser shortcut, never navigates', () => {
      setup();
      (document.activeElement as HTMLElement | null)?.blur();

      document.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'n', ctrlKey: true, bubbles: true }),
      );

      expect(navSpy).not.toHaveBeenCalled();
    });
  });
  // #407 (ADR 0032): `n` used to throw an in-progress capture away with no
  // question at all — a latent bug, not a precedent. The CanDeactivate guard
  // closes it. The tests above spy on `navigateByUrl`, so they stop short of the
  // guard; these drive the whole real path instead — the shell's keydown
  // handler, the router, and the guard — because that is where the data loss
  // lived.
  //
  // Note the reachable path is `/data-entry/:id` → `/data-entry`: the router
  // defaults to `onSameUrlNavigation: 'ignore'`, so pressing `n` while already
  // on `/data-entry` is inert and never reaches a guard.
  describe('the guard closes the `n` shortcut (#407, ADR 0032)', () => {
    let midCapture = false;
    const dialogMock = { open: jasmine.createSpy('dialog.open') };

    // Stands in for the capture form. That the *real* form publishes its dirty
    // state truthfully is data-entry-form.spec.ts's job; what is under test here
    // is the shell → router → guard chain around it.
    @Component({ template: 'Erfassung' })
    class CaptureStub {
      constructor() {
        const unsavedChanges = inject(UnsavedChangesService);
        const probe = () => midCapture;
        unsavedChanges.watch(probe);
        inject(DestroyRef).onDestroy(() => unsavedChanges.stopWatching(probe));
      }
    }

    async function setup(startUrl: string): Promise<Router> {
      TestBed.resetTestingModule();
      midCapture = false;
      dialogMock.open.calls.reset();
      dialogMock.open.and.returnValue({ afterClosed: () => of(false) });
      await TestBed.configureTestingModule({
        imports: [App],
        providers: [
          provideRouter([
            { path: 'data-entry', component: CaptureStub, canDeactivate: [unsavedChangesGuard] },
            {
              path: 'data-entry/:id',
              component: CaptureStub,
              canDeactivate: [unsavedChangesGuard],
            },
          ]),
          provideHttpClient(),
          provideHttpClientTesting(),
          provideNoopAnimations(),
          { provide: MatDialog, useValue: dialogMock },
        ],
      }).compileComponents();
      const fixture = TestBed.createComponent(App);
      const router = TestBed.inject(Router);
      await router.navigateByUrl(startUrl);
      fixture.detectChanges();
      return router;
    }

    /** A bare `n` with nothing editable focused — the Beringer's reflex. */
    async function pressN(router: Router): Promise<void> {
      (document.activeElement as HTMLElement | null)?.blur();
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'n', bubbles: true }));
      // The guard answers through a dialog Observable, so let the navigation
      // settle before reading the URL.
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
      expect(router).toBeDefined();
    }

    const askedToDiscard = (): boolean =>
      dialogMock.open.calls.all().some((call) => call.args[0] === ConfirmDialogComponent);

    it('asks first, and stays on the capture when the Beringer declines', async () => {
      const router = await setup('/data-entry/5');
      midCapture = true;
      dialogMock.open.and.returnValue({ afterClosed: () => of(false) });

      await pressN(router);

      expect(askedToDiscard()).withContext('a reflex must not cost measurements').toBeTrue();
      expect(router.url).withContext('declining keeps the bird in hand').toBe('/data-entry/5');
    });

    it('opens the fresh capture form once the Beringer confirms discarding', async () => {
      const router = await setup('/data-entry/5');
      midCapture = true;
      dialogMock.open.and.returnValue({ afterClosed: () => of(true) });

      await pressN(router);

      expect(askedToDiscard()).toBeTrue();
      expect(router.url).toBe('/data-entry');
    });

    it('opens the fresh capture form with no question when nothing is in progress', async () => {
      const router = await setup('/data-entry/5');
      midCapture = false;

      await pressN(router);

      expect(askedToDiscard()).withContext('an untouched form is never asked about').toBeFalse();
      expect(router.url).toBe('/data-entry');
    });
  });
});
