import { TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { provideNoopAnimations } from '@angular/platform-browser/animations';

import { App } from './app';

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
});
