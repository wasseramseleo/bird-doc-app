import { FormControl } from '@angular/forms';

import { selectedOptionValidator } from './selected-option.validator';

describe('selectedOptionValidator', () => {
  it('rejects unmatched free text the user typed but never picked from the list', () => {
    const control = new FormControl('Kohlmeisx');

    expect(selectedOptionValidator(control)).toEqual({ unmatchedOption: true });
  });

  it('accepts a selected record (an option object), not just any string', () => {
    const control = new FormControl({ id: 's1', common_name_de: 'Kohlmeise' });

    expect(selectedOptionValidator(control)).toBeNull();
  });

  it('accepts an option keyed by handle (e.g. a Station has no id)', () => {
    const control = new FormControl({ handle: 'STAMT', name: 'Linz' });

    expect(selectedOptionValidator(control)).toBeNull();
  });

  it('passes empty values through — Validators.required owns emptiness', () => {
    expect(selectedOptionValidator(new FormControl(null))).toBeNull();
    expect(selectedOptionValidator(new FormControl(''))).toBeNull();
  });
});
