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
