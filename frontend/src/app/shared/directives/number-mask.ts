import { Directive, ElementRef, inject, input } from '@angular/core';

/**
 * Issue #341: a hard input filter for the capture form's numeric fields — a mask
 * distinct from the value-range Plausibilitätswarnung. It stops garbage (letters,
 * a minus sign, an exponent, a malformed `12.55.3`) from ever entering the field.
 *
 * Two variants, chosen by the attribute value:
 *  - `decimal`  — digits with at most one fraction digit; accepts a comma OR a dot
 *                 as the separator and normalises the comma to a dot for storage.
 *  - `integer`  — whole numbers only, no decimal.
 *
 * Typed characters are vetted on `beforeinput`; a rejected key is dropped and a
 * comma is rewritten to a dot in place. Pastes are sanitised the same way rather
 * than accepted verbatim. Deletions and caret moves pass through untouched.
 */
@Directive({
  selector: 'input[appNumberMask]',
  standalone: true,
  host: {
    '(beforeinput)': 'onBeforeInput($event)',
    '(paste)': 'onPaste($event)',
  },
})
export class NumberMaskDirective {
  readonly mode = input<'decimal' | 'integer'>('decimal', { alias: 'appNumberMask' });

  private readonly el = inject<ElementRef<HTMLInputElement>>(ElementRef);

  onBeforeInput(event: InputEvent): void {
    // Only guard insertions; deletions, history and caret events are none of our
    // business.
    if (!event.inputType || !event.inputType.startsWith('insert')) return;
    // A paste surfaces here as `insertFromPaste`; onPaste already owns it (and
    // has richer clipboard access), so let that path handle it.
    if (event.inputType === 'insertFromPaste') return;

    const el = this.el.nativeElement;
    const start = el.selectionStart ?? el.value.length;
    const end = el.selectionEnd ?? el.value.length;
    const raw = event.data ?? '';

    // A single-character keystroke is the common path: normalise a comma, then
    // accept-or-reject against the partial-value pattern.
    const normalised = this.mode() === 'decimal' ? raw.replace(/,/g, '.') : raw;
    const candidate = el.value.slice(0, start) + normalised + el.value.slice(end);

    if (!this.isAcceptablePartial(candidate)) {
      event.preventDefault();
      return;
    }

    // Acceptable, but we had to rewrite the character (comma → dot): perform the
    // insertion ourselves so the mutated value reaches the control.
    if (normalised !== raw) {
      event.preventDefault();
      this.commit(candidate, start + normalised.length);
    }
    // Otherwise the character is already clean — let the native insert run.
  }

  onPaste(event: ClipboardEvent): void {
    const text = event.clipboardData?.getData('text') ?? '';
    if (!text) return;

    event.preventDefault();

    const el = this.el.nativeElement;
    const start = el.selectionStart ?? el.value.length;
    const end = el.selectionEnd ?? el.value.length;
    const merged = this.sanitiseFull(el.value.slice(0, start) + text + el.value.slice(end));
    this.commit(merged, merged.length);
  }

  /** Write the masked value back to the DOM and notify the value accessor. */
  private commit(value: string, caret: number): void {
    const el = this.el.nativeElement;
    el.value = value;
    const clamped = Math.min(caret, value.length);
    el.setSelectionRange(clamped, clamped);
    el.dispatchEvent(new Event('input', { bubbles: true }));
  }

  /** Whether a value is a valid *in-progress* entry (a lone/trailing dot is ok). */
  private isAcceptablePartial(value: string): boolean {
    if (this.mode() === 'integer') return /^\d*$/.test(value);
    return /^\d*(\.\d?)?$/.test(value);
  }

  /** Coerce arbitrary text into the canonical masked value (for pastes). */
  private sanitiseFull(value: string): string {
    if (this.mode() === 'integer') {
      // Whole numbers only: keep the leading run of digits, drop a decimal tail.
      return value.split(/[.,]/)[0].replace(/\D/g, '');
    }

    let s = value.replace(/,/g, '.').replace(/[^\d.]/g, '');
    const firstDot = s.indexOf('.');
    if (firstDot !== -1) {
      const intPart = s.slice(0, firstDot);
      const fracPart = s
        .slice(firstDot + 1)
        .replace(/\./g, '')
        .slice(0, 1);
      s = fracPart ? `${intPart}.${fracPart}` : intPart;
    }
    return s;
  }
}
