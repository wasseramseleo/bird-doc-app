import { Component } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { FormControl, ReactiveFormsModule } from '@angular/forms';
import { By } from '@angular/platform-browser';

import { NumberMaskDirective } from './number-mask';

@Component({
  imports: [NumberMaskDirective, ReactiveFormsModule],
  template: `
    <input appNumberMask="decimal" [formControl]="decimal" data-testid="decimal" />
    <input appNumberMask="integer" [formControl]="integer" data-testid="integer" />
  `,
})
class HostComponent {
  readonly decimal = new FormControl<string | null>('');
  readonly integer = new FormControl<string | null>('');
}

describe('NumberMaskDirective', () => {
  let fixture: ComponentFixture<HostComponent>;
  let host: HostComponent;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [HostComponent],
    }).compileComponents();

    fixture = TestBed.createComponent(HostComponent);
    host = fixture.componentInstance;
    fixture.detectChanges();
  });

  const input = (testid: string) =>
    fixture.debugElement.query(By.css(`[data-testid="${testid}"]`)).nativeElement as HTMLInputElement;

  /** Simulate a single-character keystroke at the current caret via beforeinput. */
  const typeChar = (el: HTMLInputElement, char: string): InputEvent => {
    const event = new InputEvent('beforeinput', {
      data: char,
      inputType: 'insertText',
      cancelable: true,
      bubbles: true,
    });
    el.dispatchEvent(event);
    return event;
  };

  /** Position the caret so an inserted char lands where the test wants it. */
  const seed = (el: HTMLInputElement, value: string, caret = value.length) => {
    el.value = value;
    el.setSelectionRange(caret, caret);
  };

  const paste = (el: HTMLInputElement, text: string): void => {
    const data = new DataTransfer();
    data.setData('text/plain', text);
    el.dispatchEvent(
      new ClipboardEvent('paste', { clipboardData: data, cancelable: true, bubbles: true }),
    );
  };

  describe('decimal variant', () => {
    it('rejects letters', () => {
      const el = input('decimal');
      seed(el, '');
      const event = typeChar(el, 'a');
      expect(event.defaultPrevented).toBe(true);
      expect(el.value).toBe('');
    });

    it('rejects a minus sign', () => {
      const el = input('decimal');
      seed(el, '');
      const event = typeChar(el, '-');
      expect(event.defaultPrevented).toBe(true);
    });

    it('rejects an exponent', () => {
      const el = input('decimal');
      seed(el, '12');
      const event = typeChar(el, 'e');
      expect(event.defaultPrevented).toBe(true);
    });

    it('rejects a second decimal separator', () => {
      const el = input('decimal');
      seed(el, '12.5');
      const event = typeChar(el, '.');
      expect(event.defaultPrevented).toBe(true);
    });

    it('rejects a second decimal digit', () => {
      const el = input('decimal');
      seed(el, '12.5');
      const event = typeChar(el, '3');
      expect(event.defaultPrevented).toBe(true);
      expect(el.value).toBe('12.5');
    });

    it('accepts a comma as the decimal separator and normalises it to a dot', () => {
      const el = input('decimal');
      // caret between the 7 and the 5, so the comma lands in the middle → "7.5"
      seed(el, '75', 1);
      const event = typeChar(el, ',');

      expect(event.defaultPrevented).toBe(true);
      expect(el.value).toBe('7.5');
      expect(host.decimal.value).toBe('7.5');
    });

    it('lets a plain digit through without intercepting the native insert', () => {
      const el = input('decimal');
      seed(el, '1');
      const event = typeChar(el, '2');
      expect(event.defaultPrevented).toBe(false);
    });

    it('sanitises a pasted malformed value instead of accepting it verbatim', () => {
      const el = input('decimal');
      seed(el, '');
      paste(el, '12.55.3');
      expect(el.value).toBe('12.5');
      expect(host.decimal.value).toBe('12.5');
    });

    it('sanitises a pasted comma value to a dot', () => {
      const el = input('decimal');
      seed(el, '');
      paste(el, 'ab7,5xy');
      expect(el.value).toBe('7.5');
      expect(host.decimal.value).toBe('7.5');
    });
  });

  describe('integer variant', () => {
    it('rejects a decimal dot', () => {
      const el = input('integer');
      seed(el, '12');
      const event = typeChar(el, '.');
      expect(event.defaultPrevented).toBe(true);
      expect(el.value).toBe('12');
    });

    it('rejects a comma', () => {
      const el = input('integer');
      seed(el, '12');
      const event = typeChar(el, ',');
      expect(event.defaultPrevented).toBe(true);
    });

    it('rejects letters', () => {
      const el = input('integer');
      seed(el, '');
      const event = typeChar(el, 'a');
      expect(event.defaultPrevented).toBe(true);
    });

    it('lets whole-number digits through', () => {
      const el = input('integer');
      seed(el, '4');
      const event = typeChar(el, '2');
      expect(event.defaultPrevented).toBe(false);
    });

    it('strips the decimal portion from a pasted value', () => {
      const el = input('integer');
      seed(el, '');
      paste(el, '12.5');
      expect(el.value).toBe('12');
      expect(host.integer.value).toBe('12');
    });
  });
});
