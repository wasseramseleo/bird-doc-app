import {Directive, HostListener, inject, Optional} from '@angular/core';
import {MatAutocompleteTrigger} from '@angular/material/autocomplete';
import {NgControl} from '@angular/forms';

@Directive({
  selector: 'input[selectOnTab]',
  standalone: true,
})
export class SelectOnTabDirective {
  private readonly ngControl = inject(NgControl, { self: true, optional: true });
  constructor(@Optional() private autoTrigger: MatAutocompleteTrigger) {}

  @HostListener('keydown.tab')
  onTab() {
    if (this.autoTrigger.activeOption) {
      const selectedValue = this.autoTrigger.activeOption.value;
      this.ngControl?.control?.setValue(selectedValue);
      this.autoTrigger.activeOption.select();
    }
  }
}
