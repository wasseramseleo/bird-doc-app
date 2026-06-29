import { AbstractControl, ValidationErrors } from '@angular/forms';

/**
 * #58: rejects free text left in an autocomplete control that was never confirmed
 * from the list. A picked option is the record object; unmatched free text stays
 * a plain string. Empty values pass — Validators.required owns emptiness — so the
 * two validators compose without overlapping messages.
 *
 * Applied to the Art, Station and Beringer controls so a mistyped value fails
 * inline instead of POSTing a missing id and surfacing as an opaque 400.
 */
export function selectedOptionValidator(control: AbstractControl): ValidationErrors | null {
  const value = control.value;
  if (value === null || value === undefined || value === '') {
    return null;
  }
  return typeof value === 'string' ? { unmatchedOption: true } : null;
}
